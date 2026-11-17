import test from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient, Socket } from 'socket.io-client';
import { createCatanServer } from './roomManager';
import {
  ClientGameState,
  GameActionPayload,
  GameRoom,
  createEmptyResources,
} from '../shared/types';
import {
  getValidSetupRoadEdges,
  getValidSetupSettlementVertices,
} from '../shared/catan';

function emitAck<T = any>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ack of ${event}`));
    }, 3000);
    const done = (res: T) => {
      clearTimeout(timer);
      resolve(res);
    };
    if (payload === undefined) {
      socket.emit(event, done);
    } else {
      socket.emit(event, payload, done);
    }
  });
}

function waitForEvent<T = any>(
  socket: Socket,
  event: string,
  predicate?: (data: T) => boolean
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 4000);

    const handler = (data: T) => {
      if (!predicate || predicate(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}

const trackedSockets: Socket[] = [];

async function connectAndAuth(
  port: number,
  nickname: string,
  pin: string
): Promise<{ socket: Socket; userId: string; sessionToken: string }> {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  trackedSockets.push(socket);
  await waitForEvent(socket, 'connect');
  const auth = await emitAck<{ ok: boolean; user: { id: string }; sessionToken: string; error?: string }>(
    socket,
    'auth:authenticate',
    { nickname, pin }
  );
  assert.equal(auth.ok, true, auth.error);
  return { socket, userId: auth.user.id, sessionToken: auth.sessionToken };
}

test('21-15 Scenarios 1..8: 4-player sync, 2H+2AI, reconnect PIN security, trade, duplicate requestId, victory', async () => {
  const srv = createCatanServer({ aiDelayMs: 40 });
  await new Promise<void>((resolve) => srv.httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = srv.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3000;

  try {
    // Scenario 1: 4 human players join the same room and start game
    const p1 = await connectAndAuth(port, '호스트', '1234');
    const p2 = await connectAndAuth(port, '플레이어2', '2222');
    const p3 = await connectAndAuth(port, '플레이어3', '3333');
    const p4 = await connectAndAuth(port, '플레이어4', '4444');

    const created = await emitAck<{ ok: boolean; room: GameRoom }>(p1.socket, 'room:create', {
      settings: { roomName: '테스트방', maxPlayers: 4, isPublic: true },
    });
    assert.equal(created.ok, true);
    const code = created.room.code;

    assert.equal((await emitAck<any>(p2.socket, 'room:join', { code })).ok, true);
    assert.equal((await emitAck<any>(p3.socket, 'room:join', { code })).ok, true);
    assert.equal((await emitAck<any>(p4.socket, 'room:join', { code })).ok, true);

    await emitAck(p2.socket, 'room:toggle_ready');
    await emitAck(p3.socket, 'room:toggle_ready');
    await emitAck(p4.socket, 'room:toggle_ready');

    const p2StatePromise = waitForEvent<{ state: ClientGameState }>(p2.socket, 'game:state');
    const startRes = await emitAck<any>(p1.socket, 'room:start_game');
    assert.equal(startRes.ok, true);
    const { state: s2 } = await p2StatePromise;
    assert.equal(s2.players.length, 4);

    // Scenario 5 & 6: Security projection (p2 cannot see p1 resources, client cannot spoof out-of-turn)
    const p1InS2 = s2.players.find((p) => p.id === p1.userId)!;
    assert.equal(p1InS2.resources, undefined);

    const activeId = s2.players[s2.currentPlayerIndex].id;
    const socketsById = new Map<string, Socket>([
      [p1.userId, p1.socket],
      [p2.userId, p2.socket],
      [p3.userId, p3.socket],
      [p4.userId, p4.socket],
    ]);

    // Wrong player tries to place settlement
    const wrongId = s2.players.find((p) => p.id !== activeId)!.id;
    const validVerts = getValidSetupSettlementVertices(s2 as never);
    const wrongAct = await emitAck<any>(socketsById.get(wrongId)!, 'game:action', {
      type: 'PLACE_SETUP_SETTLEMENT',
      vertexId: validVerts[0],
      requestId: 'spoof_1',
    } satisfies GameActionPayload);
    assert.equal(wrongAct.ok, false);

    // Scenario 7: Duplicate requestId does not execute twice
    const activeSocket = socketsById.get(activeId)!;
    const otherSocket = socketsById.get(wrongId)!;
    const broadcastPromise = waitForEvent<{ state: ClientGameState }>(otherSocket, 'game:state');
    const firstAct = await emitAck<any>(activeSocket, 'game:action', {
      type: 'PLACE_SETUP_SETTLEMENT',
      vertexId: validVerts[0],
      requestId: 'unique_setup_1',
    } satisfies GameActionPayload);
    assert.equal(firstAct.ok, true);
    const { state: afterBroadcast } = await broadcastPromise;
    assert.equal(afterBroadcast.phase, 'SETUP_ROAD');

    const dupAct = await emitAck<any>(activeSocket, 'game:action', {
      type: 'PLACE_SETUP_SETTLEMENT',
      vertexId: validVerts[1],
      requestId: 'unique_setup_1',
    } satisfies GameActionPayload);
    assert.equal(dupAct.ok, true);
    assert.equal(dupAct.duplicate, true);

    // Scenario 3: Disconnect and PIN-authenticated Reconnect + Wrong PIN blocked
    const impostor = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    await waitForEvent(impostor, 'connect');
    const badAuth = await emitAck<any>(impostor, 'auth:authenticate', {
      nickname: '플레이어2',
      pin: '9999',
    });
    assert.equal(badAuth.ok, false);
    impostor.disconnect();

    p2.socket.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    const roomObj = srv.store.rooms.get(created.room.id)!;
    assert.equal(roomObj.players.find((p) => p.id === p2.userId)!.connected, false);

    const p2Re = await connectAndAuth(port, '플레이어2', '2222');
    const rejoin = await emitAck<{ ok: boolean; reconnected?: boolean; state?: ClientGameState }>(
      p2Re.socket,
      'room:join',
      { code }
    );
    assert.equal(rejoin.ok, true);
    assert.equal(rejoin.reconnected, true);
    assert.ok(rejoin.state);

    p1.socket.disconnect();
    p2Re.socket.disconnect();
    p3.socket.disconnect();
    p4.socket.disconnect();

    // Scenario 2 & 4 & 8: 2 humans + 2 AI play, trade sync, and victory saved to GameRecords
    const h1 = await connectAndAuth(port, '인간A', '1111');
    const h2 = await connectAndAuth(port, '인간B', '2222');
    const mixedRoomRes = await emitAck<{ ok: boolean; room: GameRoom }>(h1.socket, 'room:create', {
      settings: { roomName: '혼합방', maxPlayers: 4, allowAI: true, victoryPointsTarget: 10 },
    });
    const mCode = mixedRoomRes.room.code;
    await emitAck(h2.socket, 'room:join', { code: mCode });
    await emitAck(h2.socket, 'room:toggle_ready');
    await emitAck(h1.socket, 'room:add_ai', { difficulty: 'normal' });
    await emitAck(h1.socket, 'room:add_ai', { difficulty: 'normal' });

    let latestState: ClientGameState | null = null;
    const getLatest = (): ClientGameState | null => latestState;
    h1.socket.on('game:state', (d: { state: ClientGameState }) => {
      latestState = d.state;
    });

    await emitAck(h1.socket, 'room:start_game');
    while (!getLatest()) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // Complete setup for humans while AI auto-plays its turns
    let safety = 0;
    while (safety < 40) {
      const snap = getLatest();
      if (!snap || (snap.phase !== 'SETUP_SETTLEMENT' && snap.phase !== 'SETUP_ROAD')) {
        break;
      }
      safety++;
      const cur = snap.players[snap.currentPlayerIndex];
      if (!cur.isAI) {
        const sock = cur.id === h1.userId ? h1.socket : h2.socket;
        if (snap.phase === 'SETUP_SETTLEMENT') {
          const verts = getValidSetupSettlementVertices(snap as never);
          await emitAck(sock, 'game:action', {
            type: 'PLACE_SETUP_SETTLEMENT',
            vertexId: verts[0],
            requestId: `m_s_${safety}`,
          });
        } else {
          const edges = getValidSetupRoadEdges(snap as never, snap.setupLastSettlementVertexId);
          await emitAck(sock, 'game:action', {
            type: 'PLACE_SETUP_ROAD',
            edgeId: edges[0],
            requestId: `m_r_${safety}`,
          });
        }
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    // Force server state into h1 MAIN for deterministic trade & victory test
    const rawState = srv.store.gameStates.get(mixedRoomRes.room.id)!;
    const h1Idx = rawState.players.findIndex((p) => p.id === h1.userId);
    const h2Idx = rawState.players.findIndex((p) => p.id === h2.userId);
    rawState.currentPlayerIndex = h1Idx;
    rawState.phase = 'MAIN';
    rawState.dice = [3, 4];
    rawState.players[h1Idx].resources = { ...createEmptyResources(), wood: 3, brick: 2, sheep: 1, wheat: 1, ore: 0 };
    rawState.players[h2Idx].resources = { ...createEmptyResources(), wood: 0, brick: 2, sheep: 0, wheat: 0, ore: 0 };

    // Scenario 4: Online trade offer & accept reflected to both players
    const offerAck = await emitAck<any>(h1.socket, 'game:action', {
      type: 'OFFER_TRADE',
      give: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      want: { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 0 },
      requestId: 'trade_offer_sync',
    });
    assert.equal(offerAck.ok, true);
    const offerId = srv.store.gameStates.get(mixedRoomRes.room.id)!.activeTradeOffers[0].id;

    const h1TradeBroadcast = waitForEvent<{ state: ClientGameState }>(
      h1.socket,
      'game:state',
      (d) => d.state.activeTradeOffers.length === 0
    );
    const acceptAck = await emitAck<any>(h2.socket, 'game:action', {
      type: 'ACCEPT_TRADE',
      offerId,
      requestId: 'trade_accept_sync',
    });
    assert.equal(acceptAck.ok, true);
    const afterTrade = (await h1TradeBroadcast).state;
    assert.equal(afterTrade.players[h1Idx].resources!.wood, 2);
    assert.equal(afterTrade.players[h1Idx].resources!.brick, 3);

    // Scenario 8: Victory broadcast identical to all players & saved to GameRecords
    const srvStateNow = srv.store.gameStates.get(mixedRoomRes.room.id)!;
    srvStateNow.players[h1Idx].devCards.push(
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint'
    );
    srvStateNow.players[h1Idx].resources = { ...createEmptyResources(), wood: 1, brick: 1 };

    const endWait1 = waitForEvent<{ state: ClientGameState }>(
      h1.socket,
      'game:state',
      (d) => d.state.phase === 'GAME_OVER'
    );
    const endWait2 = waitForEvent<{ state: ClientGameState }>(
      h2.socket,
      'game:state',
      (d) => d.state.phase === 'GAME_OVER'
    );

    const validEdges = Object.values(srvStateNow.edges).filter(
      (e) =>
        e.ownerId === null &&
        (srvStateNow.vertices[e.v1].ownerId === h1.userId ||
          srvStateNow.vertices[e.v2].ownerId === h1.userId ||
          srvStateNow.vertices[e.v1].adjacentEdgeIds.some(
            (eid) => srvStateNow.edges[eid].ownerId === h1.userId
          ) ||
          srvStateNow.vertices[e.v2].adjacentEdgeIds.some(
            (eid) => srvStateNow.edges[eid].ownerId === h1.userId
          ))
    );
    assert.ok(validEdges.length > 0);
    const winAck = await emitAck<any>(h1.socket, 'game:action', {
      type: 'BUILD_ROAD',
      edgeId: validEdges[0].id,
      requestId: 'win_trigger_road',
    });
    assert.equal(winAck.ok, true, winAck.error);

    const [end1, end2] = await Promise.all([endWait1, endWait2]);
    assert.equal(end1.state.winnerId, h1.userId);
    assert.equal(end2.state.winnerId, h1.userId);
    assert.ok(srv.store.gameRecords.length >= 1);

    h1.socket.disconnect();
    h2.socket.disconnect();
  } finally {
    for (const s of trackedSockets) {
      s.disconnect();
    }
    srv.cleanup();
    srv.io.disconnectSockets(true);
    srv.io.close();
    srv.httpServer.closeAllConnections?.();
    srv.httpServer.close();
  }
});
