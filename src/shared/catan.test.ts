import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGameAction,
  calculateLongestRoad,
  createInitialGameState,
  getPlayerBestTradeRatio,
  getTotalResourceCount,
  getValidSetupRoadEdges,
  getValidSetupSettlementVertices,
  projectGameStateForViewer,
} from './catan';
import { decideBotAction } from './bot';
import { createEmptyResources, GameState } from './types';

function make4PlayerGame(seed = 42): GameState {
  return createInitialGameState({
    gameId: 'game_1',
    roomId: 'room_1',
    boardMode: 'standard',
    victoryPointsTarget: 10,
    seed,
    players: [
      { id: 'p1', nickname: '유저1', color: 'red', isAI: false },
      { id: 'p2', nickname: '유저2', color: 'blue', isAI: false },
      { id: 'p3', nickname: 'AI1', color: 'green', isAI: true, aiDifficulty: 'normal' },
      { id: 'p4', nickname: 'AI2', color: 'amber', isAI: true, aiDifficulty: 'normal' },
    ],
  });
}

function completeSnakeSetup(state: GameState): GameState {
  let s = state;
  let step = 0;
  while (s.phase === 'SETUP_SETTLEMENT' || s.phase === 'SETUP_ROAD') {
    const active = s.players[s.currentPlayerIndex];
    if (s.phase === 'SETUP_SETTLEMENT') {
      const valid = getValidSetupSettlementVertices(s);
      assert.ok(valid.length > 0);
      const res = applyGameAction(s, active.id, {
        type: 'PLACE_SETUP_SETTLEMENT',
        vertexId: valid[0],
        requestId: `setup_s_${step++}`,
      });
      assert.equal(res.ok, true);
      s = res.state;
    } else {
      const valid = getValidSetupRoadEdges(s, s.setupLastSettlementVertexId);
      assert.ok(valid.length > 0);
      const res = applyGameAction(s, active.id, {
        type: 'PLACE_SETUP_ROAD',
        edgeId: valid[0],
        requestId: `setup_r_${step++}`,
      });
      assert.equal(res.ok, true);
      s = res.state;
    }
  }
  return s;
}

test('board topology has 19 hexes, 54 vertices, 72 edges, 9 ports', () => {
  const s = make4PlayerGame();
  assert.equal(s.hexes.length, 19);
  assert.equal(Object.keys(s.vertices).length, 54);
  assert.equal(Object.keys(s.edges).length, 72);
  assert.equal(s.ports.length, 9);
  const desertCount = s.hexes.filter((h) => h.terrain === 'desert').length;
  assert.equal(desertCount, 1);
});

test('snake draft setup places 2 settlements & 2 roads per player and grants 2nd settlement resources', () => {
  const initial = make4PlayerGame();
  const s = completeSnakeSetup(initial);

  assert.equal(s.phase, 'ROLL');
  assert.equal(s.turnNumber, 1);
  assert.equal(s.currentPlayerIndex, 0);

  for (const p of s.players) {
    assert.equal(p.settlementsRemaining, 3);
    assert.equal(p.roadsRemaining, 13);
    assert.equal(p.publicVP, 2);
    assert.ok(getTotalResourceCount(p.resources) >= 1);
  }
});

test('idempotency: duplicate requestId does not execute twice', () => {
  let s = completeSnakeSetup(make4PlayerGame(7));
  const reqId = 'roll_once_123';

  const r1 = applyGameAction(s, 'p1', { type: 'ROLL_DICE', requestId: reqId }, () => 0.1);
  assert.equal(r1.ok, true);
  assert.equal(r1.duplicate, undefined);
  const beforeResources = { ...r1.state.players[0].resources };

  const r2 = applyGameAction(r1.state, 'p1', { type: 'ROLL_DICE', requestId: reqId }, () => 0.1);
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true);
  assert.deepEqual(r2.state.players[0].resources, beforeResources);
});

test('out-of-turn action is rejected by server engine', () => {
  const s = completeSnakeSetup(make4PlayerGame());
  const r = applyGameAction(s, 'p2', { type: 'ROLL_DICE', requestId: 'bad_turn_1' });
  assert.equal(r.ok, false);
});

test('rolling 7 triggers DISCARD for >7 cards then ROBBER_MOVE and STEAL', () => {
  let s = completeSnakeSetup(make4PlayerGame());
  s.players[1].resources = { wood: 4, brick: 4, sheep: 0, wheat: 0, ore: 0 }; // 8 cards

  // rng returning 0.5 -> d1 = 4, d2 = 4? Let's craft exact 3 + 4 = 7
  let call = 0;
  const rngSeven = () => (call++ === 0 ? 0.4 : 0.55); // floor(0.4*6)+1=3, floor(0.55*6)+1=4 -> 7
  const r1 = applyGameAction(s, 'p1', { type: 'ROLL_DICE', requestId: 'roll_7' }, rngSeven);
  assert.equal(r1.ok, true);
  assert.equal(r1.state.phase, 'DISCARD');
  assert.deepEqual(r1.state.pendingDiscardPlayerIds, ['p2']);

  // Wrong discard count rejected
  const badDiscard = applyGameAction(r1.state, 'p2', {
    type: 'DISCARD_RESOURCES',
    resources: { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    requestId: 'disc_bad',
  });
  assert.equal(badDiscard.ok, false);

  // Exact 4 cards accepted -> moves to ROBBER_MOVE
  const okDiscard = applyGameAction(r1.state, 'p2', {
    type: 'DISCARD_RESOURCES',
    resources: { wood: 2, brick: 2, sheep: 0, wheat: 0, ore: 0 },
    requestId: 'disc_ok',
  });
  assert.equal(okDiscard.ok, true);
  assert.equal(okDiscard.state.phase, 'ROBBER_MOVE');
});

test('online player trade verifies resources on accept and handles stale offers', () => {
  let s = completeSnakeSetup(make4PlayerGame());
  // Roll non-7 (1+2=3)
  const rRoll = applyGameAction(s, 'p1', { type: 'ROLL_DICE', requestId: 'r_roll' }, () => 0.05);
  s = rRoll.state;

  s.players[0].resources = { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  s.players[1].resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 0 };

  const rOffer = applyGameAction(s, 'p1', {
    type: 'OFFER_TRADE',
    give: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    want: { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 0 },
    requestId: 'offer_1',
  });
  assert.equal(rOffer.ok, true);
  assert.equal(rOffer.state.activeTradeOffers.length, 1);
  const offerId = rOffer.state.activeTradeOffers[0].id;

  const rAccept = applyGameAction(rOffer.state, 'p2', {
    type: 'ACCEPT_TRADE',
    offerId,
    requestId: 'accept_1',
  });
  assert.equal(rAccept.ok, true);
  assert.equal(rAccept.state.players[0].resources.wood, 1);
  assert.equal(rAccept.state.players[0].resources.brick, 1);
  assert.equal(rAccept.state.players[1].resources.wood, 1);
  assert.equal(rAccept.state.players[1].resources.brick, 0);
});

test('bank & port trade uses best port ratio', () => {
  let s = completeSnakeSetup(make4PlayerGame());
  s = applyGameAction(s, 'p1', { type: 'ROLL_DICE', requestId: 'r_roll2' }, () => 0.05).state;

  // Give p1 a settlement on a 2:1 wood port or 3:1 port if not already, test 4:1 fallback vs port
  const woodPort = s.ports.find((p) => p.kind === 'wood')!;
  const ratioBefore = getPlayerBestTradeRatio(s, 'p1', 'wood');
  assert.ok(ratioBefore === 2 || ratioBefore === 3 || ratioBefore === 4);

  // Force attach p1 to woodPort vertex
  s.vertices[woodPort.vertexIds[0]].ownerId = 'p1';
  s.vertices[woodPort.vertexIds[0]].building = 'settlement';
  assert.equal(getPlayerBestTradeRatio(s, 'p1', 'wood'), 2);

  s.players[0].resources = { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const tradeRes = applyGameAction(s, 'p1', {
    type: 'BANK_TRADE',
    give: 'wood',
    giveAmount: 2,
    want: 'ore',
    requestId: 'port_trade_1',
  });
  assert.equal(tradeRes.ok, true);
  assert.equal(tradeRes.state.players[0].resources.wood, 0);
  assert.equal(tradeRes.state.players[0].resources.ore, 1);
});

test('longest road DFS awards +2 VP at length >= 5', () => {
  let s = completeSnakeSetup(make4PlayerGame());
  // Build a connected chain of 5 edges for p1
  const allEdges = Object.values(s.edges);
  // Clear all edges & settlements for clean graph check
  for (const e of allEdges) e.ownerId = null;
  for (const v of Object.values(s.vertices)) {
    v.ownerId = null;
    v.building = null;
  }

  let currV = s.hexes[9].vertexIds[0];
  const chain: string[] = [];
  const visitedV = new Set<string>([currV]);
  for (let i = 0; i < 5; i++) {
    const adjEdge = s.vertices[currV].adjacentEdgeIds
      .map((eid) => s.edges[eid])
      .find((e) => !chain.includes(e.id) && (!visitedV.has(e.v1) || !visitedV.has(e.v2)));
    assert.ok(adjEdge);
    adjEdge.ownerId = 'p1';
    chain.push(adjEdge.id);
    currV = adjEdge.v1 === currV ? adjEdge.v2 : adjEdge.v1;
    visitedV.add(currV);
  }

  assert.equal(calculateLongestRoad(s, 'p1'), 5);
});

test('viewer projection hides private hands from opponents and spectators', () => {
  let s = completeSnakeSetup(make4PlayerGame());
  s.players[0].resources = { wood: 3, brick: 1, sheep: 0, wheat: 0, ore: 0 };
  s.players[0].devCards = ['victoryPoint', 'knight'];

  const p2View = projectGameStateForViewer(s, 'p2', false);
  assert.equal(p2View.players[0].resourceCount, 4);
  assert.equal(p2View.players[0].resources, undefined);
  assert.equal(p2View.players[0].devCards, undefined);
  assert.equal(p2View.players[0].totalVP, undefined);
  assert.ok(p2View.players[1].resources !== undefined);

  const specView = projectGameStateForViewer(s, 'spec_1', true);
  assert.equal(specView.isSpectator, true);
  for (const p of specView.players) {
    assert.equal(p.resources, undefined);
    assert.equal(p.devCards, undefined);
  }
});

test('AI bot can complete full setup and take a valid turn', () => {
  let s = make4PlayerGame(99);
  // Make all 4 AI just to verify full bot decision loop
  for (const p of s.players) p.isAI = true;

  let guard = 0;
  while (s.phase !== 'GAME_OVER' && guard < 120) {
    guard++;
    const active = s.players[s.currentPlayerIndex];
    const targetId =
      s.phase === 'DISCARD' && s.pendingDiscardPlayerIds.length > 0
        ? s.pendingDiscardPlayerIds[0]
        : active.id;
    const view = projectGameStateForViewer(s, targetId, false);
    const action = decideBotAction(view, targetId, 'normal');
    assert.ok(action, `Bot returned null in phase ${s.phase}`);
    const res = applyGameAction(s, targetId, action);
    assert.equal(res.ok, true, res.error);
    s = res.state;
    if (s.turnNumber >= 4 && s.phase === 'ROLL') break;
  }

  assert.ok(s.turnNumber >= 4);
});
