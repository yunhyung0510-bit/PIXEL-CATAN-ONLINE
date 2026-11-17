import { createRng, generateBoard, shuffleArray } from './board';
import {
  AIDifficulty,
  BoardMode,
  ClientGameState,
  createEmptyResources,
  DEV_CARD_LABELS_KO,
  DevCardType,
  GameActionPayload,
  GameLogEntry,
  GamePhase,
  GameState,
  PlayerColor,
  PlayerGameState,
  PublicPlayerGameState,
  RESOURCE_LABELS_KO,
  RESOURCE_TYPES,
  ResourceMap,
  ResourceType,
  TERRAIN_TO_RESOURCE,
  TradeOffer,
} from './types';

export interface InitPlayerInput {
  id: string;
  nickname: string;
  color: PlayerColor;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  connected?: boolean;
}

export interface CreateGameOptions {
  gameId: string;
  roomId: string;
  boardMode: BoardMode;
  victoryPointsTarget: number;
  players: InitPlayerInput[];
  seed?: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  state: GameState;
  events: string[];
  duplicate?: boolean;
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function createDevCardDeck(rng: () => number): DevCardType[] {
  const deck: DevCardType[] = [
    ...Array<DevCardType>(14).fill('knight'),
    ...Array<DevCardType>(5).fill('victoryPoint'),
    ...Array<DevCardType>(2).fill('roadBuilding'),
    ...Array<DevCardType>(2).fill('yearOfPlenty'),
    ...Array<DevCardType>(2).fill('monopoly'),
  ];
  return shuffleArray(deck, rng);
}

export function getTotalResourceCount(resources: ResourceMap): number {
  return (
    resources.wood +
    resources.brick +
    resources.sheep +
    resources.wheat +
    resources.ore
  );
}

function hasResources(hand: ResourceMap, cost: Partial<ResourceMap>): boolean {
  for (const res of RESOURCE_TYPES) {
    const needed = cost[res] ?? 0;
    if (needed < 0 || hand[res] < needed) return false;
  }
  return true;
}

function deductResources(hand: ResourceMap, cost: Partial<ResourceMap>): void {
  for (const res of RESOURCE_TYPES) {
    hand[res] -= cost[res] ?? 0;
  }
}

function addResources(hand: ResourceMap, gain: Partial<ResourceMap>): void {
  for (const res of RESOURCE_TYPES) {
    hand[res] += gain[res] ?? 0;
  }
}

function appendLog(
  state: GameState,
  type: GameLogEntry['type'],
  text: string
): void {
  state.logs.push({
    id: `log_${state.logs.length + 1}_${Date.now()}`,
    timestamp: Date.now(),
    type,
    text,
  });
  if (state.logs.length > 150) {
    state.logs = state.logs.slice(-150);
  }
}

export function createInitialGameState(options: CreateGameOptions): GameState {
  const rng = createRng(options.seed);
  const board = generateBoard(options.boardMode, rng);
  const players: PlayerGameState[] = options.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    color: p.color,
    isAI: p.isAI,
    aiDifficulty: p.aiDifficulty,
    connected: p.connected ?? true,
    resources: createEmptyResources(),
    devCards: [],
    newlyBoughtDevCards: [],
    playedKnights: 0,
    roadsRemaining: 15,
    settlementsRemaining: 5,
    citiesRemaining: 4,
    longestRoadLength: 0,
    hasLongestRoad: false,
    hasLargestArmy: false,
    publicVP: 0,
    totalVP: 0,
  }));

  const state: GameState = {
    id: options.gameId,
    roomId: options.roomId,
    victoryPointsTarget: options.victoryPointsTarget,
    phase: 'SETUP_SETTLEMENT',
    turnNumber: 0,
    currentPlayerIndex: 0,
    setupRound: 1,
    setupLastSettlementVertexId: null,
    dice: null,
    robberHexId: board.robberHexId,
    robberFromKnight: false,
    pendingDiscardPlayerIds: [],
    stealCandidatePlayerIds: [],
    devCardDeck: createDevCardDeck(rng),
    devCardPlayedThisTurn: false,
    freeRoadsRemaining: 0,
    activeTradeOffers: [],
    hexes: board.hexes,
    vertices: board.vertices,
    edges: board.edges,
    ports: board.ports,
    players,
    playerOrder: players.map((p) => p.id),
    winnerId: null,
    logs: [],
    processedRequestIds: [],
    startedAt: Date.now(),
    endedAt: null,
  };

  appendLog(
    state,
    'system',
    `게임이 시작되었습니다! 목표 승점은 ${options.victoryPointsTarget}점입니다. ${players[0].nickname}님부터 초기 마을을 건설하세요.`
  );

  return state;
}

export function getValidSetupSettlementVertices(state: GameState): string[] {
  return Object.values(state.vertices)
    .filter((v) => {
      if (v.ownerId !== null) return false;
      for (const adjId of v.adjacentVertexIds) {
        if (state.vertices[adjId]?.ownerId !== null) return false;
      }
      return true;
    })
    .map((v) => v.id);
}

export function getValidSetupRoadEdges(
  state: GameState,
  settlementVertexId: string | null
): string[] {
  if (!settlementVertexId) return [];
  const vertex = state.vertices[settlementVertexId];
  if (!vertex) return [];
  return vertex.adjacentEdgeIds.filter((eid) => state.edges[eid]?.ownerId === null);
}

export function getValidRoadEdges(state: GameState, playerId: string): string[] {
  return Object.values(state.edges)
    .filter((edge) => {
      if (edge.ownerId !== null) return false;
      const endpoints = [edge.v1, edge.v2];
      for (const vid of endpoints) {
        const v = state.vertices[vid];
        if (!v) continue;
        // Player's own building directly connects
        if (v.ownerId === playerId) return true;
        // If vertex is empty (not blocked by opponent's building), check player's adjacent roads
        if (v.ownerId === null) {
          const hasMyRoad = v.adjacentEdgeIds.some(
            (adjEid) => adjEid !== edge.id && state.edges[adjEid]?.ownerId === playerId
          );
          if (hasMyRoad) return true;
        }
      }
      return false;
    })
    .map((e) => e.id);
}

export function getValidSettlementVertices(
  state: GameState,
  playerId: string
): string[] {
  return Object.values(state.vertices)
    .filter((v) => {
      if (v.ownerId !== null) return false;
      // Distance rule: no adjacent settlements/cities
      for (const adjId of v.adjacentVertexIds) {
        if (state.vertices[adjId]?.ownerId !== null) return false;
      }
      // Must connect to at least one road owned by player
      return v.adjacentEdgeIds.some((eid) => state.edges[eid]?.ownerId === playerId);
    })
    .map((v) => v.id);
}

export function getValidCityVertices(state: GameState, playerId: string): string[] {
  return Object.values(state.vertices)
    .filter((v) => v.ownerId === playerId && v.building === 'settlement')
    .map((v) => v.id);
}

export function getPlayerBestTradeRatio(
  state: GameState,
  playerId: string,
  giveResource: ResourceType
): 2 | 3 | 4 {
  let best: 2 | 3 | 4 = 4;
  for (const port of state.ports) {
    const ownsPort = port.vertexIds.some(
      (vid) => state.vertices[vid]?.ownerId === playerId
    );
    if (!ownsPort) continue;
    if (port.kind === giveResource) return 2;
    if (port.kind === 'generic') best = 3;
  }
  return best;
}

export function calculateLongestRoad(state: GameState, playerId: string): number {
  const playerEdges = Object.values(state.edges).filter((e) => e.ownerId === playerId);
  if (playerEdges.length === 0) return 0;

  // Build adjacency map of vertices -> playerEdges
  const vertexEdges: Record<string, typeof playerEdges> = {};
  for (const edge of playerEdges) {
    if (!vertexEdges[edge.v1]) vertexEdges[edge.v1] = [];
    if (!vertexEdges[edge.v2]) vertexEdges[edge.v2] = [];
    vertexEdges[edge.v1].push(edge);
    vertexEdges[edge.v2].push(edge);
  }

  let maxLen = 0;

  function dfs(currentVertexId: string, usedEdgeIds: Set<string>): number {
    const v = state.vertices[currentVertexId];
    // Blocked by an opponent's settlement/city (except at the start of traversal)
    if (usedEdgeIds.size > 0 && v && v.ownerId !== null && v.ownerId !== playerId) {
      return 0;
    }

    let best = 0;
    const adj = vertexEdges[currentVertexId] ?? [];
    for (const edge of adj) {
      if (usedEdgeIds.has(edge.id)) continue;
      usedEdgeIds.add(edge.id);
      const nextVertexId = edge.v1 === currentVertexId ? edge.v2 : edge.v1;
      const len = 1 + dfs(nextVertexId, usedEdgeIds);
      if (len > best) best = len;
      usedEdgeIds.delete(edge.id);
    }
    return best;
  }

  for (const startVertexId of Object.keys(vertexEdges)) {
    const v = state.vertices[startVertexId];
    // Can't start inside an opponent settlement and pass through, though starting AT an opponent settlement outgoing edge is allowed to measure its outer side
    if (v && v.ownerId !== null && v.ownerId !== playerId) {
      for (const edge of vertexEdges[startVertexId]) {
        const nextV = edge.v1 === startVertexId ? edge.v2 : edge.v1;
        const used = new Set<string>([edge.id]);
        const len = 1 + dfs(nextV, used);
        if (len > maxLen) maxLen = len;
      }
      continue;
    }
    const len = dfs(startVertexId, new Set());
    if (len > maxLen) maxLen = len;
  }

  return maxLen;
}

export function recomputeAwardsAndScores(state: GameState): void {
  // 1. Update longest road lengths
  for (const p of state.players) {
    p.longestRoadLength = calculateLongestRoad(state, p.id);
  }

  const currentLongestHolder = state.players.find((p) => p.hasLongestRoad) ?? null;
  let longestHolderId: string | null = null;
  let longestRecord = 4; // Must be >= 5 to claim

  if (currentLongestHolder && currentLongestHolder.longestRoadLength >= 5) {
    longestHolderId = currentLongestHolder.id;
    longestRecord = currentLongestHolder.longestRoadLength;
  }

  for (const p of state.players) {
    if (p.longestRoadLength > longestRecord) {
      longestRecord = p.longestRoadLength;
      longestHolderId = p.id;
    }
  }

  for (const p of state.players) {
    const had = p.hasLongestRoad;
    p.hasLongestRoad = p.id === longestHolderId;
    if (!had && p.hasLongestRoad) {
      appendLog(
        state,
        'system',
        `${p.nickname}님이 최장 교역로(${p.longestRoadLength}연결) 보너스 +2점을 획득했습니다!`
      );
    }
  }

  // 2. Largest army (>= 3 played knights)
  const currentArmyHolder = state.players.find((p) => p.hasLargestArmy) ?? null;
  let armyHolderId: string | null = null;
  let armyRecord = 2; // Must be >= 3 to claim

  if (currentArmyHolder && currentArmyHolder.playedKnights >= 3) {
    armyHolderId = currentArmyHolder.id;
    armyRecord = currentArmyHolder.playedKnights;
  }

  for (const p of state.players) {
    if (p.playedKnights > armyRecord) {
      armyRecord = p.playedKnights;
      armyHolderId = p.id;
    }
  }

  for (const p of state.players) {
    const had = p.hasLargestArmy;
    p.hasLargestArmy = p.id === armyHolderId;
    if (!had && p.hasLargestArmy) {
      appendLog(
        state,
        'system',
        `${p.nickname}님이 최강 기사단(기사 ${p.playedKnights}회) 보너스 +2점을 획득했습니다!`
      );
    }
  }

  // 3. Victory Points
  const vertexList = Object.values(state.vertices);
  for (const p of state.players) {
    let buildingsVP = 0;
    for (const v of vertexList) {
      if (v.ownerId === p.id) {
        buildingsVP += v.building === 'city' ? 2 : v.building === 'settlement' ? 1 : 0;
      }
    }
    const awardVP = (p.hasLongestRoad ? 2 : 0) + (p.hasLargestArmy ? 2 : 0);
    const hiddenVP =
      p.devCards.filter((c) => c === 'victoryPoint').length +
      p.newlyBoughtDevCards.filter((c) => c === 'victoryPoint').length;
    p.publicVP = buildingsVP + awardVP;
    p.totalVP = p.publicVP + hiddenVP;
  }

  // 4. Check victory for current player
  const activePlayer = state.players[state.currentPlayerIndex];
  if (
    activePlayer &&
    state.phase !== 'GAME_OVER' &&
    activePlayer.totalVP >= state.victoryPointsTarget
  ) {
    state.phase = 'GAME_OVER';
    state.winnerId = activePlayer.id;
    state.endedAt = Date.now();
    appendLog(
      state,
      'victory',
      `${activePlayer.nickname}님이 승점 ${activePlayer.totalVP}점을 달성하여 승리했습니다!`
    );
  }
}

export function applyGameAction(
  prevState: GameState,
  actorPlayerId: string,
  action: GameActionPayload,
  rng: () => number = Math.random
): ActionResult {
  // Idempotency check
  if (!action.requestId || typeof action.requestId !== 'string') {
    return { ok: false, error: '유효한 요청 ID가 필요합니다.', state: prevState, events: [] };
  }
  if (prevState.processedRequestIds.includes(action.requestId)) {
    return {
      ok: true,
      duplicate: true,
      state: prevState,
      events: [],
    };
  }

  if (prevState.phase === 'GAME_OVER') {
    return { ok: false, error: '이미 종료된 게임입니다.', state: prevState, events: [] };
  }

  const actorIdx = prevState.players.findIndex((p) => p.id === actorPlayerId);
  if (actorIdx === -1) {
    return { ok: false, error: '이 게임의 참가자가 아닙니다.', state: prevState, events: [] };
  }

  const state = cloneState(prevState);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const actor = state.players[actorIdx];
  const events: string[] = [];

  const markProcessed = () => {
    state.processedRequestIds.push(action.requestId);
    if (state.processedRequestIds.length > 500) {
      state.processedRequestIds = state.processedRequestIds.slice(-500);
    }
  };

  // Actions allowed off-turn: DISCARD_RESOURCES (when in pendingDiscard), ACCEPT_TRADE, REJECT_TRADE
  const isCurrentTurn = actor.id === currentPlayer.id;

  switch (action.type) {
    case 'PLACE_SETUP_SETTLEMENT': {
      if (!isCurrentTurn || state.phase !== 'SETUP_SETTLEMENT') {
        return { ok: false, error: '초기 마을 건설 차례가 아닙니다.', state: prevState, events };
      }
      const valid = getValidSetupSettlementVertices(state);
      if (!valid.includes(action.vertexId)) {
        return { ok: false, error: '해당 위치에 마을을 지을 수 없습니다.', state: prevState, events };
      }
      const vertex = state.vertices[action.vertexId];
      vertex.ownerId = actor.id;
      vertex.building = 'settlement';
      actor.settlementsRemaining -= 1;
      state.setupLastSettlementVertexId = vertex.id;
      state.phase = 'SETUP_ROAD';

      // Second setup settlement grants 1 resource per adjacent resource tile
      if (state.setupRound === 2) {
        const gained: string[] = [];
        for (const hid of vertex.adjacentHexIds) {
          const hex = state.hexes[hid];
          const res = hex ? TERRAIN_TO_RESOURCE[hex.terrain] : null;
          if (res) {
            actor.resources[res] += 1;
            gained.push(RESOURCE_LABELS_KO[res]);
          }
        }
        appendLog(
          state,
          'build',
          `${actor.nickname}님이 2차 초기 마을을 짓고 시작 자원(${gained.length > 0 ? gained.join(', ') : '없음'})을 받았습니다.`
        );
      } else {
        appendLog(state, 'build', `${actor.nickname}님이 초기 마을을 건설했습니다.`);
      }

      recomputeAwardsAndScores(state);
      markProcessed();
      events.push('setup_settlement');
      return { ok: true, state, events };
    }

    case 'PLACE_SETUP_ROAD': {
      if (!isCurrentTurn || state.phase !== 'SETUP_ROAD') {
        return { ok: false, error: '초기 도로 건설 차례가 아닙니다.', state: prevState, events };
      }
      const valid = getValidSetupRoadEdges(state, state.setupLastSettlementVertexId);
      if (!valid.includes(action.edgeId)) {
        return { ok: false, error: '방금 지은 마을과 연결된 도로만 지을 수 있습니다.', state: prevState, events };
      }
      const edge = state.edges[action.edgeId];
      edge.ownerId = actor.id;
      actor.roadsRemaining -= 1;
      state.setupLastSettlementVertexId = null;

      appendLog(state, 'build', `${actor.nickname}님이 초기 도로를 건설했습니다.`);

      // Advance snake draft order
      const n = state.players.length;
      if (state.setupRound === 1) {
        if (state.currentPlayerIndex < n - 1) {
          state.currentPlayerIndex += 1;
          state.phase = 'SETUP_SETTLEMENT';
        } else {
          // Stay on last player for round 2
          state.setupRound = 2;
          state.phase = 'SETUP_SETTLEMENT';
        }
      } else {
        if (state.currentPlayerIndex > 0) {
          state.currentPlayerIndex -= 1;
          state.phase = 'SETUP_SETTLEMENT';
        } else {
          // Setup complete -> Player 0 starts Turn 1
          state.turnNumber = 1;
          state.currentPlayerIndex = 0;
          state.phase = 'ROLL';
          appendLog(
            state,
            'system',
            `초기 배치가 완료되었습니다! ${state.players[0].nickname}님의 1턴이 시작됩니다.`
          );
        }
      }

      recomputeAwardsAndScores(state);
      markProcessed();
      events.push('setup_road');
      return { ok: true, state, events };
    }

    case 'ROLL_DICE': {
      if (!isCurrentTurn || state.phase !== 'ROLL') {
        return { ok: false, error: '지금은 주사위를 굴릴 수 없습니다.', state: prevState, events };
      }
      const d1 = Math.floor(rng() * 6) + 1;
      const d2 = Math.floor(rng() * 6) + 1;
      const sum = d1 + d2;
      state.dice = [d1, d2];

      appendLog(state, 'dice', `${actor.nickname}님이 주사위를 굴렸습니다: ${d1} + ${d2} = ${sum}`);

      if (sum === 7) {
        const mustDiscard = state.players
          .filter((p) => getTotalResourceCount(p.resources) > 7)
          .map((p) => p.id);

        if (mustDiscard.length > 0) {
          state.pendingDiscardPlayerIds = mustDiscard;
          state.robberFromKnight = false;
          state.phase = 'DISCARD';
          appendLog(
            state,
            'robber',
            `7이 나왔습니다! 자원이 8장 이상인 플레이어는 절반을 버려야 합니다.`
          );
        } else {
          state.robberFromKnight = false;
          state.phase = 'ROBBER_MOVE';
          appendLog(state, 'robber', `7이 나왔습니다! ${actor.nickname}님이 도둑을 이동시킵니다.`);
        }
      } else {
        // Resource distribution
        const gainsByPlayer: Record<string, ResourceMap> = {};
        for (const p of state.players) {
          gainsByPlayer[p.id] = createEmptyResources();
        }
        for (const hex of state.hexes) {
          if (hex.numberToken !== sum || hex.id === state.robberHexId) continue;
          const res = TERRAIN_TO_RESOURCE[hex.terrain];
          if (!res) continue;
          for (const vid of hex.vertexIds) {
            const v = state.vertices[vid];
            if (!v || !v.ownerId || !v.building) continue;
            const amount = v.building === 'city' ? 2 : 1;
            gainsByPlayer[v.ownerId][res] += amount;
          }
        }

        const gainSummaries: string[] = [];
        for (const p of state.players) {
          const g = gainsByPlayer[p.id];
          addResources(p.resources, g);
          const parts = RESOURCE_TYPES.filter((r) => g[r] > 0).map(
            (r) => `${RESOURCE_LABELS_KO[r]} ${g[r]}`
          );
          if (parts.length > 0) {
            gainSummaries.push(`${p.nickname}(${parts.join(', ')})`);
          }
        }
        if (gainSummaries.length > 0) {
          appendLog(state, 'dice', `자원 생산: ${gainSummaries.join(' · ')}`);
        } else {
          appendLog(state, 'dice', `이번 주사위로 생산된 자원이 없습니다.`);
        }

        state.phase = 'MAIN';
      }

      markProcessed();
      events.push('roll_dice');
      return { ok: true, state, events };
    }

    case 'DISCARD_RESOURCES': {
      if (state.phase !== 'DISCARD' || !state.pendingDiscardPlayerIds.includes(actor.id)) {
        return { ok: false, error: '지금은 자원을 버릴 차례가 아닙니다.', state: prevState, events };
      }
      const totalOwned = getTotalResourceCount(actor.resources);
      const requiredDiscard = Math.floor(totalOwned / 2);
      const submittedTotal = getTotalResourceCount(action.resources);

      if (submittedTotal !== requiredDiscard) {
        return {
          ok: false,
          error: `정확히 ${requiredDiscard}장의 자원을 버려야 합니다.`,
          state: prevState,
          events,
        };
      }
      if (!hasResources(actor.resources, action.resources)) {
        return { ok: false, error: '보유한 자원보다 많이 버릴 수 없습니다.', state: prevState, events };
      }

      deductResources(actor.resources, action.resources);
      state.pendingDiscardPlayerIds = state.pendingDiscardPlayerIds.filter(
        (pid) => pid !== actor.id
      );

      appendLog(state, 'robber', `${actor.nickname}님이 자원 ${requiredDiscard}장을 버렸습니다.`);

      if (state.pendingDiscardPlayerIds.length === 0) {
        state.phase = 'ROBBER_MOVE';
        appendLog(
          state,
          'robber',
          `모든 플레이어가 자원을 버렸습니다. ${currentPlayer.nickname}님이 도둑을 이동시킵니다.`
        );
      }

      markProcessed();
      events.push('discard');
      return { ok: true, state, events };
    }

    case 'MOVE_ROBBER': {
      if (!isCurrentTurn || state.phase !== 'ROBBER_MOVE') {
        return { ok: false, error: '지금은 도둑을 이동할 수 없습니다.', state: prevState, events };
      }
      const targetHex = state.hexes.find((h) => h.id === action.hexId);
      if (!targetHex) {
        return { ok: false, error: '유효하지 않은 타일입니다.', state: prevState, events };
      }
      if (action.hexId === state.robberHexId) {
        return { ok: false, error: '도둑은 현재와 다른 타일로 이동해야 합니다.', state: prevState, events };
      }

      state.robberHexId = action.hexId;

      const victimIds = Array.from(
        new Set(
          targetHex.vertexIds
            .map((vid) => state.vertices[vid]?.ownerId)
            .filter(
              (oid): oid is string =>
                Boolean(oid) &&
                oid !== actor.id &&
                getTotalResourceCount(
                  state.players.find((p) => p.id === oid)?.resources ?? createEmptyResources()
                ) > 0
            )
        )
      );

      if (victimIds.length === 0) {
        state.stealCandidatePlayerIds = [];
        state.phase = state.dice === null ? 'ROLL' : 'MAIN';
        appendLog(state, 'robber', `${actor.nickname}님이 도둑을 이동했습니다. (약탈 대상 없음)`);
      } else if (victimIds.length === 1) {
        const victim = state.players.find((p) => p.id === victimIds[0])!;
        const pool: ResourceType[] = [];
        for (const res of RESOURCE_TYPES) {
          for (let i = 0; i < victim.resources[res]; i++) pool.push(res);
        }
        const stolen = pool[Math.floor(rng() * pool.length)];
        victim.resources[stolen] -= 1;
        actor.resources[stolen] += 1;
        state.stealCandidatePlayerIds = [];
        state.phase = state.dice === null ? 'ROLL' : 'MAIN';
        appendLog(
          state,
          'robber',
          `${actor.nickname}님이 도둑을 이동하고 ${victim.nickname}님의 자원 1장을 약탈했습니다.`
        );
      } else {
        state.stealCandidatePlayerIds = victimIds;
        state.phase = 'ROBBER_STEAL';
        appendLog(
          state,
          'robber',
          `${actor.nickname}님이 도둑을 이동했습니다. 약탈할 플레이어를 선택하세요.`
        );
      }

      markProcessed();
      events.push('move_robber');
      return { ok: true, state, events };
    }

    case 'STEAL_RESOURCE': {
      if (!isCurrentTurn || state.phase !== 'ROBBER_STEAL') {
        return { ok: false, error: '지금은 자원을 약탈할 수 없습니다.', state: prevState, events };
      }
      if (!state.stealCandidatePlayerIds.includes(action.targetPlayerId)) {
        return { ok: false, error: '약탈 가능한 대상이 아닙니다.', state: prevState, events };
      }
      const victim = state.players.find((p) => p.id === action.targetPlayerId);
      if (!victim) {
        return { ok: false, error: '대상 플레이어를 찾을 수 없습니다.', state: prevState, events };
      }
      const pool: ResourceType[] = [];
      for (const res of RESOURCE_TYPES) {
        for (let i = 0; i < victim.resources[res]; i++) pool.push(res);
      }
      if (pool.length > 0) {
        const stolen = pool[Math.floor(rng() * pool.length)];
        victim.resources[stolen] -= 1;
        actor.resources[stolen] += 1;
      }
      state.stealCandidatePlayerIds = [];
      state.phase = state.dice === null ? 'ROLL' : 'MAIN';
      appendLog(
        state,
        'robber',
        `${actor.nickname}님이 ${victim.nickname}님의 자원 1장을 약탈했습니다.`
      );

      markProcessed();
      events.push('steal');
      return { ok: true, state, events };
    }

    case 'BUILD_ROAD': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '지금은 도로를 건설할 수 없습니다.', state: prevState, events };
      }
      if (actor.roadsRemaining <= 0) {
        return { ok: false, error: '더 이상 남은 도로 말이 없습니다.', state: prevState, events };
      }
      const validEdges = getValidRoadEdges(state, actor.id);
      if (!validEdges.includes(action.edgeId)) {
        return { ok: false, error: '연결 가능한 위치에만 도로를 지을 수 있습니다.', state: prevState, events };
      }

      const isFree = state.freeRoadsRemaining > 0;
      if (!isFree) {
        const cost: Partial<ResourceMap> = { wood: 1, brick: 1 };
        if (!hasResources(actor.resources, cost)) {
          return { ok: false, error: '도로 건설 자원(나무 1, 벽돌 1)이 부족합니다.', state: prevState, events };
        }
        deductResources(actor.resources, cost);
      } else {
        state.freeRoadsRemaining -= 1;
      }

      state.edges[action.edgeId].ownerId = actor.id;
      actor.roadsRemaining -= 1;
      appendLog(
        state,
        'build',
        `${actor.nickname}님이 도로를 건설했습니다.${isFree ? ' (도로 건설 카드)' : ''}`
      );

      recomputeAwardsAndScores(state);
      markProcessed();
      events.push('build_road');
      return { ok: true, state, events };
    }

    case 'BUILD_SETTLEMENT': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '지금은 마을을 건설할 수 없습니다.', state: prevState, events };
      }
      if (actor.settlementsRemaining <= 0) {
        return { ok: false, error: '더 이상 남은 마을 말이 없습니다.', state: prevState, events };
      }
      const validVertices = getValidSettlementVertices(state, actor.id);
      if (!validVertices.includes(action.vertexId)) {
        return {
          ok: false,
          error: '자신의 도로와 연결되고 인접 마을이 없는 위치에만 건설할 수 있습니다.',
          state: prevState,
          events,
        };
      }
      const cost: Partial<ResourceMap> = { wood: 1, brick: 1, sheep: 1, wheat: 1 };
      if (!hasResources(actor.resources, cost)) {
        return {
          ok: false,
          error: '마을 건설 자원(나무 1, 벽돌 1, 양 1, 밀 1)이 부족합니다.',
          state: prevState,
          events,
        };
      }
      deductResources(actor.resources, cost);
      const vertex = state.vertices[action.vertexId];
      vertex.ownerId = actor.id;
      vertex.building = 'settlement';
      actor.settlementsRemaining -= 1;

      appendLog(state, 'build', `${actor.nickname}님이 새로운 마을을 건설했습니다.`);
      recomputeAwardsAndScores(state);
      markProcessed();
      events.push('build_settlement');
      return { ok: true, state, events };
    }

    case 'UPGRADE_CITY': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '지금은 도시로 업그레이드할 수 없습니다.', state: prevState, events };
      }
      if (actor.citiesRemaining <= 0) {
        return { ok: false, error: '더 이상 남은 도시 말이 없습니다.', state: prevState, events };
      }
      const validVertices = getValidCityVertices(state, actor.id);
      if (!validVertices.includes(action.vertexId)) {
        return { ok: false, error: '자신의 마을만 도시로 업그레이드할 수 있습니다.', state: prevState, events };
      }
      const cost: Partial<ResourceMap> = { wheat: 2, ore: 3 };
      if (!hasResources(actor.resources, cost)) {
        return {
          ok: false,
          error: '도시 업그레이드 자원(밀 2, 철광석 3)이 부족합니다.',
          state: prevState,
          events,
        };
      }
      deductResources(actor.resources, cost);
      state.vertices[action.vertexId].building = 'city';
      actor.citiesRemaining -= 1;
      actor.settlementsRemaining += 1;

      appendLog(state, 'build', `${actor.nickname}님이 마을을 도시로 업그레이드했습니다!`);
      recomputeAwardsAndScores(state);
      markProcessed();
      events.push('upgrade_city');
      return { ok: true, state, events };
    }

    case 'BUY_DEV_CARD': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '지금은 발전 카드를 구매할 수 없습니다.', state: prevState, events };
      }
      if (state.devCardDeck.length === 0) {
        return { ok: false, error: '남은 발전 카드가 없습니다.', state: prevState, events };
      }
      const cost: Partial<ResourceMap> = { sheep: 1, wheat: 1, ore: 1 };
      if (!hasResources(actor.resources, cost)) {
        return {
          ok: false,
          error: '발전 카드 구매 자원(양 1, 밀 1, 철광석 1)이 부족합니다.',
          state: prevState,
          events,
        };
      }
      deductResources(actor.resources, cost);
      const card = state.devCardDeck.pop()!;
      if (card === 'victoryPoint') {
        actor.devCards.push(card);
      } else {
        actor.newlyBoughtDevCards.push(card);
      }

      appendLog(state, 'dev', `${actor.nickname}님이 발전 카드 1장을 구매했습니다.`);
      recomputeAwardsAndScores(state);
      markProcessed();
      events.push('buy_dev_card');
      return { ok: true, state, events };
    }

    case 'PLAY_DEV_CARD': {
      if (!isCurrentTurn || (state.phase !== 'MAIN' && !(state.phase === 'ROLL' && action.card === 'knight'))) {
        return { ok: false, error: '지금은 발전 카드를 사용할 수 없습니다.', state: prevState, events };
      }
      if (state.devCardPlayedThisTurn) {
        return { ok: false, error: '한 턴에는 1장의 발전 카드만 사용할 수 있습니다.', state: prevState, events };
      }
      const cardIdx = actor.devCards.indexOf(action.card);
      if (cardIdx === -1) {
        return {
          ok: false,
          error: '사용 가능한 해당 발전 카드가 없습니다. (이번 턴에 구매한 카드는 다음 턴부터 사용 가능)',
          state: prevState,
          events,
        };
      }

      actor.devCards.splice(cardIdx, 1);
      state.devCardPlayedThisTurn = true;

      if (action.card === 'knight') {
        actor.playedKnights += 1;
        state.robberFromKnight = true;
        state.phase = 'ROBBER_MOVE';
        appendLog(state, 'dev', `${actor.nickname}님이 기사 카드를 사용했습니다! 도둑을 이동하세요.`);
        recomputeAwardsAndScores(state);
      } else if (action.card === 'roadBuilding') {
        const freeCount = Math.min(2, actor.roadsRemaining);
        state.freeRoadsRemaining += freeCount;
        appendLog(
          state,
          'dev',
          `${actor.nickname}님이 도로 건설 카드를 사용했습니다! (무료 도로 ${freeCount}개)`
        );
      } else if (action.card === 'yearOfPlenty') {
        const picks = action.resources ?? [];
        if (picks.length !== 2 || picks.some((r) => !RESOURCE_TYPES.includes(r))) {
          return { ok: false, error: '풍요의 해 카드는 자원 2개를 선택해야 합니다.', state: prevState, events };
        }
        actor.resources[picks[0]] += 1;
        actor.resources[picks[1]] += 1;
        appendLog(
          state,
          'dev',
          `${actor.nickname}님이 풍요의 해 카드로 ${RESOURCE_LABELS_KO[picks[0]]}, ${RESOURCE_LABELS_KO[picks[1]]} 자원을 획득했습니다.`
        );
      } else if (action.card === 'monopoly') {
        const picks = action.resources ?? [];
        if (picks.length !== 1 || !RESOURCE_TYPES.includes(picks[0])) {
          return { ok: false, error: '독점 카드는 자원 1종을 선택해야 합니다.', state: prevState, events };
        }
        const targetRes = picks[0];
        let totalStolen = 0;
        for (const other of state.players) {
          if (other.id === actor.id) continue;
          const amt = other.resources[targetRes];
          if (amt > 0) {
            other.resources[targetRes] = 0;
            totalStolen += amt;
          }
        }
        actor.resources[targetRes] += totalStolen;
        appendLog(
          state,
          'dev',
          `${actor.nickname}님이 독점 카드로 ${RESOURCE_LABELS_KO[targetRes]} ${totalStolen}장을 독점했습니다!`
        );
      }

      markProcessed();
      events.push(`play_dev_${action.card}`);
      return { ok: true, state, events };
    }

    case 'BANK_TRADE': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '지금은 은행/항구 교역을 할 수 없습니다.', state: prevState, events };
      }
      if (action.give === action.want) {
        return { ok: false, error: '서로 다른 자원으로만 교역할 수 있습니다.', state: prevState, events };
      }
      const bestRatio = getPlayerBestTradeRatio(state, actor.id, action.give);
      if (action.giveAmount !== bestRatio) {
        return {
          ok: false,
          error: `현재 ${RESOURCE_LABELS_KO[action.give]} 교역 비율은 ${bestRatio}:1 입니다.`,
          state: prevState,
          events,
        };
      }
      if (actor.resources[action.give] < bestRatio) {
        return { ok: false, error: '교역할 자원이 부족합니다.', state: prevState, events };
      }

      actor.resources[action.give] -= bestRatio;
      actor.resources[action.want] += 1;

      const label = bestRatio === 4 ? '은행 교역(4:1)' : `항구 교역(${bestRatio}:1)`;
      appendLog(
        state,
        'trade',
        `${actor.nickname}님이 ${label}: ${RESOURCE_LABELS_KO[action.give]} ${bestRatio}장 → ${RESOURCE_LABELS_KO[action.want]} 1장`
      );

      markProcessed();
      events.push('bank_trade');
      return { ok: true, state, events };
    }

    case 'OFFER_TRADE': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '자신의 거래 단계에서만 거래를 제안할 수 있습니다.', state: prevState, events };
      }
      const giveTotal = getTotalResourceCount(action.give);
      const wantTotal = getTotalResourceCount(action.want);
      if (giveTotal <= 0 || wantTotal <= 0) {
        return { ok: false, error: '줄 자원과 받을 자원을 각각 1장 이상 선택하세요.', state: prevState, events };
      }
      if (!hasResources(actor.resources, action.give)) {
        return { ok: false, error: '제안할 자원을 충분히 보유하고 있지 않습니다.', state: prevState, events };
      }
      // Prevent trivial same-resource swap on both sides
      for (const res of RESOURCE_TYPES) {
        if (action.give[res] > 0 && action.want[res] > 0) {
          return { ok: false, error: '같은 종류의 자원을 동시에 주고받을 수 없습니다.', state: prevState, events };
        }
      }

      const offer: TradeOffer = {
        id: `trade_${Date.now()}_${Math.floor(rng() * 10000)}`,
        fromPlayerId: actor.id,
        targetPlayerId: action.targetPlayerId ?? null,
        give: { ...action.give },
        want: { ...action.want },
        rejectedBy: [],
        createdAt: Date.now(),
      };
      state.activeTradeOffers.push(offer);

      const giveText = RESOURCE_TYPES.filter((r) => offer.give[r] > 0)
        .map((r) => `${RESOURCE_LABELS_KO[r]} ${offer.give[r]}`)
        .join(', ');
      const wantText = RESOURCE_TYPES.filter((r) => offer.want[r] > 0)
        .map((r) => `${RESOURCE_LABELS_KO[r]} ${offer.want[r]}`)
        .join(', ');
      appendLog(
        state,
        'trade',
        `${actor.nickname}님이 거래 제안: [${giveText}] 드림 ↔ [${wantText}] 요청`
      );

      markProcessed();
      events.push('offer_trade');
      return { ok: true, state, events };
    }

    case 'ACCEPT_TRADE': {
      if (state.phase !== 'MAIN') {
        return { ok: false, error: '현재 거래 단계가 아닙니다.', state: prevState, events };
      }
      const offerIdx = state.activeTradeOffers.findIndex((o) => o.id === action.offerId);
      if (offerIdx === -1) {
        return { ok: false, error: '이미 종료되었거나 취소된 거래 제안입니다.', state: prevState, events };
      }
      const offer = state.activeTradeOffers[offerIdx];
      if (offer.fromPlayerId === actor.id) {
        return { ok: false, error: '자신의 거래 제안은 수락할 수 없습니다.', state: prevState, events };
      }
      if (offer.targetPlayerId && offer.targetPlayerId !== actor.id) {
        return { ok: false, error: '다른 플레이어에게 지정된 거래 제안입니다.', state: prevState, events };
      }

      const proposer = state.players.find((p) => p.id === offer.fromPlayerId);
      if (!proposer) {
        return { ok: false, error: '제안자를 찾을 수 없습니다.', state: prevState, events };
      }

      // Re-validate BOTH sides' resources at execution time
      if (!hasResources(proposer.resources, offer.give)) {
        state.activeTradeOffers.splice(offerIdx, 1);
        return {
          ok: false,
          error: '제안자의 자원이 변경되어 거래가 취소되었습니다.',
          state,
          events,
        };
      }
      if (!hasResources(actor.resources, offer.want)) {
        return { ok: false, error: '거래를 수락하기 위한 자원이 부족합니다.', state: prevState, events };
      }

      deductResources(proposer.resources, offer.give);
      addResources(proposer.resources, offer.want);
      deductResources(actor.resources, offer.want);
      addResources(actor.resources, offer.give);

      state.activeTradeOffers.splice(offerIdx, 1);
      appendLog(
        state,
        'trade',
        `${actor.nickname}님이 ${proposer.nickname}님의 거래 제안을 수락해 교역이 성사되었습니다!`
      );

      markProcessed();
      events.push('accept_trade');
      return { ok: true, state, events };
    }

    case 'REJECT_TRADE': {
      const offer = state.activeTradeOffers.find((o) => o.id === action.offerId);
      if (!offer) {
        return { ok: false, error: '존재하지 않는 거래 제안입니다.', state: prevState, events };
      }
      if (offer.fromPlayerId === actor.id) {
        return { ok: false, error: '자신의 제안은 거절 대신 취소를 사용하세요.', state: prevState, events };
      }
      if (!offer.rejectedBy.includes(actor.id)) {
        offer.rejectedBy.push(actor.id);
      }
      markProcessed();
      events.push('reject_trade');
      return { ok: true, state, events };
    }

    case 'CANCEL_TRADE': {
      const offerIdx = state.activeTradeOffers.findIndex((o) => o.id === action.offerId);
      if (offerIdx === -1) {
        return { ok: false, error: '존재하지 않는 거래 제안입니다.', state: prevState, events };
      }
      const offer = state.activeTradeOffers[offerIdx];
      if (offer.fromPlayerId !== actor.id) {
        return { ok: false, error: '본인이 만든 거래 제안만 취소할 수 있습니다.', state: prevState, events };
      }
      state.activeTradeOffers.splice(offerIdx, 1);
      appendLog(state, 'trade', `${actor.nickname}님이 거래 제안을 취소했습니다.`);
      markProcessed();
      events.push('cancel_trade');
      return { ok: true, state, events };
    }

    case 'END_TURN': {
      if (!isCurrentTurn || state.phase !== 'MAIN') {
        return { ok: false, error: '지금은 턴을 종료할 수 없습니다.', state: prevState, events };
      }
      // Move newly bought dev cards into playable devCards
      if (actor.newlyBoughtDevCards.length > 0) {
        actor.devCards.push(...actor.newlyBoughtDevCards);
        actor.newlyBoughtDevCards = [];
      }
      state.devCardPlayedThisTurn = false;
      state.freeRoadsRemaining = 0;
      state.activeTradeOffers = [];
      state.dice = null;
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
      state.turnNumber += 1;
      state.phase = 'ROLL';

      const nextPlayer = state.players[state.currentPlayerIndex];
      appendLog(
        state,
        'system',
        `턴 ${state.turnNumber}: ${nextPlayer.nickname}님의 차례입니다.`
      );

      markProcessed();
      events.push('end_turn');
      return { ok: true, state, events };
    }
  }
}

export function projectGameStateForViewer(
  state: GameState,
  viewerId: string,
  isSpectator: boolean = false
): ClientGameState {
  const revealAll = state.phase === 'GAME_OVER';

  const projectedPlayers: PublicPlayerGameState[] = state.players.map((p) => {
    const isSelf = !isSpectator && p.id === viewerId;
    const base: PublicPlayerGameState = {
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      isAI: p.isAI,
      aiDifficulty: p.aiDifficulty,
      connected: p.connected,
      resourceCount: getTotalResourceCount(p.resources),
      devCardCount: p.devCards.length + p.newlyBoughtDevCards.length,
      playedKnights: p.playedKnights,
      roadsRemaining: p.roadsRemaining,
      settlementsRemaining: p.settlementsRemaining,
      citiesRemaining: p.citiesRemaining,
      longestRoadLength: p.longestRoadLength,
      hasLongestRoad: p.hasLongestRoad,
      hasLargestArmy: p.hasLargestArmy,
      publicVP: p.publicVP,
    };

    if (isSelf) {
      base.resources = { ...p.resources };
      base.devCards = [...p.devCards];
      base.newlyBoughtDevCards = [...p.newlyBoughtDevCards];
      base.totalVP = p.totalVP;
    } else if (revealAll) {
      base.totalVP = p.totalVP;
    }

    return base;
  });

  return {
    id: state.id,
    roomId: state.roomId,
    victoryPointsTarget: state.victoryPointsTarget,
    phase: state.phase,
    turnNumber: state.turnNumber,
    currentPlayerIndex: state.currentPlayerIndex,
    setupRound: state.setupRound,
    setupLastSettlementVertexId: state.setupLastSettlementVertexId,
    dice: state.dice,
    robberHexId: state.robberHexId,
    pendingDiscardPlayerIds: [...state.pendingDiscardPlayerIds],
    stealCandidatePlayerIds: [...state.stealCandidatePlayerIds],
    devDeckRemaining: state.devCardDeck.length,
    devCardPlayedThisTurn: state.devCardPlayedThisTurn,
    freeRoadsRemaining: state.freeRoadsRemaining,
    activeTradeOffers: state.activeTradeOffers.map((o) => ({ ...o })),
    hexes: state.hexes,
    vertices: state.vertices,
    edges: state.edges,
    ports: state.ports,
    players: projectedPlayers,
    playerOrder: [...state.playerOrder],
    winnerId: state.winnerId,
    logs: state.logs,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    viewerId,
    isSpectator,
  };
}

export function describeActionCost(kind: 'road' | 'settlement' | 'city' | 'dev'): string {
  switch (kind) {
    case 'road':
      return '나무 1 + 벽돌 1';
    case 'settlement':
      return '나무 1 + 벽돌 1 + 양 1 + 밀 1';
    case 'city':
      return '밀 2 + 철광석 3';
    case 'dev':
      return '양 1 + 밀 1 + 철광석 1';
  }
}

export function getDevCardLabel(card: DevCardType): string {
  return DEV_CARD_LABELS_KO[card];
}
