import express from 'express';
import http from 'node:http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  AIDifficulty,
  GameActionPayload,
  GameMode,
  GameRecord,
  GameRoom,
  PLAYER_COLORS,
  RoomPlayer,
  RoomSettings,
  UserProfile,
} from '../shared/types';
import {
  applyGameAction,
  createInitialGameState,
  projectGameStateForViewer,
} from '../shared/catan';
import { decideBotAction } from '../shared/bot';
import { InMemoryStore } from './store';

interface SocketMeta {
  userId?: string;
  sessionToken?: string;
  roomId?: string;
  isSpectator?: boolean;
}

const AI_NAMES = ['아서 봇', '벨라 봇', '카일 봇', '도나 봇'];

export function createCatanServer(options?: { aiDelayMs?: number }) {
  const aiDelayMs = options?.aiDelayMs ?? 650;
  const app = express();
  app.use(express.json());

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  const store = new InMemoryStore();
  const socketMeta = new Map<string, SocketMeta>();
  const aiTimers = new Map<string, NodeJS.Timeout>();

  // REST Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: store.rooms.size, records: store.gameRecords.length });
  });

  app.post('/api/auth/login', (req, res) => {
    const { nickname, pin } = req.body ?? {};
    if (typeof nickname !== 'string' || typeof pin !== 'string') {
      return res.status(400).json({ error: '닉네임과 4자리 PIN을 입력해 주세요.' });
    }
    const result = store.registerOrLogin(nickname, pin);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }
    res.json({
      user: result.user,
      sessionToken: result.sessionToken,
      isNew: result.isNew,
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = store.getUserByToken(token);
    if (!user) return res.status(401).json({ error: '인증이 필요합니다.' });
    res.json({ user });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: store.listPublicRooms() });
  });

  app.get('/api/records', (_req, res) => {
    res.json({ records: store.gameRecords });
  });

  // Helper: broadcast public room list
  function broadcastPublicRooms() {
    io.emit('rooms:list', { rooms: store.listPublicRooms() });
  }

  // Helper: broadcast room state
  function broadcastRoomUpdate(room: GameRoom) {
    io.to(room.id).emit('room:update', { room });
    broadcastPublicRooms();
  }

  // Helper: emit securely projected GameState to each connected socket in room
  function broadcastGameState(room: GameRoom) {
    const state = store.gameStates.get(room.id);
    if (!state) return;

    const roomSocketIds = io.sockets.adapter.rooms.get(room.id);
    if (!roomSocketIds) return;

    for (const sid of roomSocketIds) {
      const s = io.sockets.sockets.get(sid);
      const meta = socketMeta.get(sid);
      if (!s || !meta || !meta.userId) continue;

      const isPlayer = state.players.some((p) => p.id === meta.userId);
      const isSpectator = Boolean(meta.isSpectator) || !isPlayer;
      const projected = projectGameStateForViewer(state, meta.userId, isSpectator);
      s.emit('game:state', { state: projected });
    }
  }

  function scheduleAIIfNeeded(room: GameRoom) {
    const existingTimer = aiTimers.get(room.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      aiTimers.delete(room.id);
    }

    const state = store.gameStates.get(room.id);
    if (!state || state.phase === 'GAME_OVER' || room.status !== 'playing') return;

    // Determine if any AI needs to act right now
    let targetAIId: string | null = null;
    let aiDifficulty: AIDifficulty = room.settings.aiDifficulty;

    if (state.phase === 'DISCARD') {
      const aiDiscarder = state.pendingDiscardPlayerIds
        .map((pid) => state.players.find((p) => p.id === pid))
        .find((p) => p?.isAI);
      if (aiDiscarder) {
        targetAIId = aiDiscarder.id;
        aiDifficulty = aiDiscarder.aiDifficulty ?? aiDifficulty;
      }
    } else if (state.phase === 'MAIN' && state.activeTradeOffers.length > 0) {
      // Let AI respond to pending open/targeted trade offers
      for (const offer of state.activeTradeOffers) {
        const aiResponder = state.players.find(
          (p) =>
            p.isAI &&
            p.id !== offer.fromPlayerId &&
            (!offer.targetPlayerId || offer.targetPlayerId === p.id) &&
            !offer.rejectedBy.includes(p.id)
        );
        if (aiResponder) {
          targetAIId = aiResponder.id;
          aiDifficulty = aiResponder.aiDifficulty ?? aiDifficulty;
          break;
        }
      }
    }

    if (!targetAIId) {
      const current = state.players[state.currentPlayerIndex];
      if (current && current.isAI) {
        targetAIId = current.id;
        aiDifficulty = current.aiDifficulty ?? aiDifficulty;
      }
    }

    if (!targetAIId) return;

    const timer = setTimeout(() => {
      aiTimers.delete(room.id);
      const latestRoom = store.rooms.get(room.id);
      const latestState = store.gameStates.get(room.id);
      if (!latestRoom || !latestState || latestState.phase === 'GAME_OVER') return;

      // AI ONLY sees its own projected ClientGameState (never human hands!)
      const aiView = projectGameStateForViewer(latestState, targetAIId!, false);
      const action = decideBotAction(aiView, targetAIId!, aiDifficulty);
      if (!action) return;

      const res = applyGameAction(latestState, targetAIId!, action);
      if (!res.ok) {
        // Fallback: if AI hit an invalid move, try END_TURN if in MAIN
        if (latestState.phase === 'MAIN') {
          const fallback = applyGameAction(latestState, targetAIId!, {
            type: 'END_TURN',
            requestId: `ai_end_${Date.now()}`,
          });
          if (fallback.ok) {
            store.gameStates.set(latestRoom.id, fallback.state);
            broadcastGameState(latestRoom);
            scheduleAIIfNeeded(latestRoom);
          }
        }
        return;
      }

      handlePostAction(latestRoom, res.state, action);
    }, aiDelayMs);

    aiTimers.set(room.id, timer);
  }

  function handlePostAction(
    room: GameRoom,
    nextState: ReturnType<typeof applyGameAction>['state'],
    action: GameActionPayload
  ) {
    store.gameStates.set(room.id, nextState);

    // Emit trade/victory chat notifications
    if (action.type === 'OFFER_TRADE') {
      const from = nextState.players.find((p) => p.id === nextState.players[nextState.currentPlayerIndex].id);
      const msg = store.addSystemChat(
        room,
        'trade',
        `${from?.nickname ?? '플레이어'}님이 새로운 거래를 제안했습니다.`
      );
      io.to(room.id).emit('chat:message', { message: msg });
    } else if (action.type === 'ACCEPT_TRADE') {
      const msg = store.addSystemChat(room, 'trade', '플레이어 간 거래가 성사되었습니다.');
      io.to(room.id).emit('chat:message', { message: msg });
    }

    if (nextState.phase === 'GAME_OVER' && room.status !== 'finished') {
      room.status = 'finished';
      const record: GameRecord = store.saveGameRecord(room, nextState);
      const msg = store.addSystemChat(
        room,
        'lifecycle',
        `게임 종료! ${record.winnerNickname}님이 승점 ${record.players[0]?.finalVP ?? nextState.victoryPointsTarget}점으로 승리했습니다!`
      );
      io.to(room.id).emit('chat:message', { message: msg });
      io.to(room.id).emit('game:ended', { record });
      broadcastRoomUpdate(room);
    }

    broadcastGameState(room);
    scheduleAIIfNeeded(room);
  }

  function startRoomGame(room: GameRoom) {
    // Randomize turn order at game start (Requirement 21-5)
    const shuffled = [...room.players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((p, idx) => {
      p.seatOrder = idx;
    });
    room.players = shuffled;
    room.status = 'playing';

    const state = createInitialGameState({
      gameId: `game_${room.id}_${Date.now()}`,
      roomId: room.id,
      boardMode: room.settings.boardMode,
      victoryPointsTarget: room.settings.victoryPointsTarget,
      players: shuffled.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        color: p.color,
        isAI: p.isAI,
        aiDifficulty: p.aiDifficulty ?? room.settings.aiDifficulty,
        connected: p.connected,
      })),
    });

    store.gameStates.set(room.id, state);
    const msg = store.addSystemChat(
      room,
      'lifecycle',
      `게임이 시작되었습니다! 플레이어 순서가 무작위로 결정되었습니다.`
    );
    io.to(room.id).emit('chat:message', { message: msg });
    broadcastRoomUpdate(room);
    broadcastGameState(room);
    scheduleAIIfNeeded(room);
  }

  function addAIBotToRoom(room: GameRoom, difficulty?: AIDifficulty): { ok: boolean; error?: string } {
    if (room.players.length >= room.settings.maxPlayers) {
      return { ok: false, error: '방 정원이 가득 찼습니다.' };
    }
    if (!room.settings.allowAI) {
      return { ok: false, error: '이 방은 AI 참가가 비허용 상태입니다.' };
    }
    const usedColors = new Set(room.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
    const usedNames = new Set(room.players.map((p) => p.nickname));
    const name = AI_NAMES.find((n) => !usedNames.has(n)) ?? `AI 봇 ${room.players.length + 1}`;
    const botId = `ai_${room.id}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    room.players.push({
      id: botId,
      nickname: name,
      color,
      isAI: true,
      aiDifficulty: difficulty ?? room.settings.aiDifficulty,
      isReady: true,
      isHost: false,
      connected: true,
      seatOrder: room.players.length,
      disconnectedAt: null,
    });
    return { ok: true };
  }

  function requireSocketUser(socket: Socket): UserProfile | null {
    const meta = socketMeta.get(socket.id);
    if (!meta?.sessionToken) return null;
    return store.getUserByToken(meta.sessionToken);
  }

  function leaveCurrentRoom(socket: Socket, markDisconnectedOnly: boolean) {
    const meta = socketMeta.get(socket.id);
    if (!meta?.roomId || !meta.userId) return;
    const room = store.rooms.get(meta.roomId);
    if (!room) {
      meta.roomId = undefined;
      meta.isSpectator = false;
      return;
    }

    socket.leave(room.id);

    if (meta.isSpectator) {
      room.spectators = room.spectators.filter((sp) => sp.id !== meta.userId);
      meta.roomId = undefined;
      meta.isSpectator = false;
      broadcastRoomUpdate(room);
      return;
    }

    const player = room.players.find((p) => p.id === meta.userId);
    if (!player) {
      meta.roomId = undefined;
      return;
    }

    if (room.status === 'playing' || room.status === 'finished') {
      if (!markDisconnectedOnly && (room.mode === 'single' || room.mode === 'ai')) {
        const timer = aiTimers.get(room.id);
        if (timer) clearTimeout(timer);
        aiTimers.delete(room.id);
        store.rooms.delete(room.id);
        store.roomsByCode.delete(room.code);
        store.gameStates.delete(room.id);
        meta.roomId = undefined;
        return;
      }

      player.connected = false;
      player.disconnectedAt = Date.now();
      const state = store.gameStates.get(room.id);
      if (state) {
        const gp = state.players.find((p) => p.id === player.id);
        if (gp) gp.connected = false;
      }
      const anyConnectedHuman = room.players.some((p) => !p.isAI && p.connected);
      if (!anyConnectedHuman && !markDisconnectedOnly) {
        const timer = aiTimers.get(room.id);
        if (timer) clearTimeout(timer);
        aiTimers.delete(room.id);
      }
      const msg = store.addSystemChat(
        room,
        'system',
        markDisconnectedOnly
          ? `${player.nickname}님의 연결이 끊어졌습니다. 재접속을 기다리는 중입니다.`
          : `${player.nickname}님이 게임을 나갔습니다.`
      );
      io.to(room.id).emit('chat:message', { message: msg });
      broadcastRoomUpdate(room);
      broadcastGameState(room);
      meta.roomId = undefined;
      return;
    }

    if (room.status === 'waiting') {
      room.players = room.players.filter((p) => p.id !== meta.userId);
      const humans = room.players.filter((p) => !p.isAI);
      if (humans.length === 0) {
        const timer = aiTimers.get(room.id);
        if (timer) clearTimeout(timer);
        aiTimers.delete(room.id);
        store.rooms.delete(room.id);
        store.roomsByCode.delete(room.code);
        store.gameStates.delete(room.id);
        broadcastPublicRooms();
      } else {
        if (room.hostId === meta.userId) {
          room.hostId = humans[0].id;
          humans[0].isHost = true;
          humans[0].isReady = true;
        }
        const msg = store.addSystemChat(room, 'system', `${player.nickname}님이 퇴장했습니다.`);
        io.to(room.id).emit('chat:message', { message: msg });
        broadcastRoomUpdate(room);
      }
    }

    meta.roomId = undefined;
  }

  io.on('connection', (socket) => {
    socketMeta.set(socket.id, {});

    socket.on('auth:authenticate', (payload: { sessionToken?: string; nickname?: string; pin?: string }, cb) => {
      if (payload?.sessionToken) {
        const user = store.getUserByToken(payload.sessionToken);
        if (user) {
          const meta = socketMeta.get(socket.id) ?? {};
          meta.userId = user.id;
          meta.sessionToken = payload.sessionToken;
          socketMeta.set(socket.id, meta);
          cb?.({ ok: true, user, sessionToken: payload.sessionToken });
          return;
        }
      }
      if (payload?.nickname && payload?.pin) {
        const res = store.registerOrLogin(payload.nickname, payload.pin);
        if (res.ok) {
          const meta = socketMeta.get(socket.id) ?? {};
          meta.userId = res.user.id;
          meta.sessionToken = res.sessionToken;
          socketMeta.set(socket.id, meta);
          cb?.({ ok: true, user: res.user, sessionToken: res.sessionToken });
          return;
        }
        cb?.({ ok: false, error: res.error });
        return;
      }
      cb?.({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    });

    socket.on('rooms:fetch', (cb) => {
      cb?.({ ok: true, rooms: store.listPublicRooms() });
    });

    // Quick start for Single Play or AI Match (creates a private room with AI and starts immediately)
    socket.on(
      'game:quick_start',
      (
        payload: {
          mode: Extract<GameMode, 'single' | 'ai'>;
          aiCount?: number;
          aiDifficulty?: AIDifficulty;
          boardMode?: RoomSettings['boardMode'];
          victoryPointsTarget?: number;
        },
        cb
      ) => {
        const user = requireSocketUser(socket);
        if (!user) return cb?.({ ok: false, error: '먼저 닉네임과 PIN으로 인증해 주세요.' });

        leaveCurrentRoom(socket, false);

        const aiCount = Math.min(3, Math.max(1, payload.aiCount ?? 3));
        const room = store.createRoom(user, payload.mode, {
          roomName: payload.mode === 'single' ? `${user.nickname}의 싱글 플레이` : `${user.nickname}의 AI 대전`,
          isPublic: false,
          maxPlayers: 1 + aiCount,
          allowAI: true,
          aiDifficulty: payload.aiDifficulty ?? 'normal',
          boardMode: payload.boardMode ?? 'random',
          victoryPointsTarget: payload.victoryPointsTarget ?? 10,
          allowSpectators: false,
        });

        for (let i = 0; i < aiCount; i++) {
          addAIBotToRoom(room, payload.aiDifficulty ?? 'normal');
        }

        const meta = socketMeta.get(socket.id)!;
        meta.roomId = room.id;
        meta.isSpectator = false;
        socket.join(room.id);

        startRoomGame(room);
        const state = store.gameStates.get(room.id)!;
        cb?.({
          ok: true,
          room,
          state: projectGameStateForViewer(state, user.id, false),
        });
      }
    );

    socket.on(
      'room:create',
      (payload: { settings: Partial<RoomSettings> }, cb) => {
        const user = requireSocketUser(socket);
        if (!user) return cb?.({ ok: false, error: '먼저 닉네임과 PIN으로 인증해 주세요.' });

        leaveCurrentRoom(socket, false);
        const room = store.createRoom(user, 'multiplayer', payload?.settings ?? {});
        const meta = socketMeta.get(socket.id)!;
        meta.roomId = room.id;
        meta.isSpectator = false;
        socket.join(room.id);

        store.addSystemChat(
          room,
          'lifecycle',
          `${user.nickname}님이 방을 생성했습니다. (방 코드: ${room.code})`
        );
        broadcastPublicRooms();
        cb?.({ ok: true, room });
      }
    );

    socket.on(
      'room:join',
      (payload: { roomId?: string; code?: string }, cb) => {
        const user = requireSocketUser(socket);
        if (!user) return cb?.({ ok: false, error: '먼저 닉네임과 PIN으로 인증해 주세요.' });

        let room: GameRoom | undefined;
        if (payload.roomId) {
          room = store.rooms.get(payload.roomId);
        } else if (payload.code) {
          const rid = store.roomsByCode.get(payload.code.trim().toUpperCase());
          if (rid) room = store.rooms.get(rid);
        }

        if (!room) {
          return cb?.({ ok: false, error: '방을 찾을 수 없습니다. 방 코드를 확인하세요.' });
        }

        // Check if this user is already a participant reconnecting
        const existingPlayer = room.players.find((p) => p.id === user.id);
        if (existingPlayer) {
          leaveCurrentRoom(socket, false);
          existingPlayer.connected = true;
          existingPlayer.disconnectedAt = null;
          const state = store.gameStates.get(room.id);
          if (state) {
            const gp = state.players.find((p) => p.id === user.id);
            if (gp) gp.connected = true;
          }
          const meta = socketMeta.get(socket.id)!;
          meta.roomId = room.id;
          meta.isSpectator = false;
          socket.join(room.id);

          const msg = store.addSystemChat(
            room,
            'system',
            `${user.nickname}님이 재접속했습니다.`
          );
          io.to(room.id).emit('chat:message', { message: msg });
          broadcastRoomUpdate(room);
          if (state) {
            broadcastGameState(room);
            cb?.({
              ok: true,
              room,
              reconnected: true,
              state: projectGameStateForViewer(state, user.id, false),
            });
            return;
          }
          cb?.({ ok: true, room, reconnected: true });
          return;
        }

        if (room.status !== 'waiting') {
          return cb?.({
            ok: false,
            error: '이미 게임이 시작된 방입니다. 관전으로 입장해 주세요.',
            canSpectate: room.settings.allowSpectators && room.status === 'playing',
            roomId: room.id,
          });
        }

        if (room.players.length >= room.settings.maxPlayers) {
          return cb?.({ ok: false, error: '방 정원이 가득 찼습니다.' });
        }

        leaveCurrentRoom(socket, false);
        const usedColors = new Set(room.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];

        const newPlayer: RoomPlayer = {
          id: user.id,
          nickname: user.nickname,
          color,
          isAI: false,
          isReady: false,
          isHost: false,
          connected: true,
          seatOrder: room.players.length,
          disconnectedAt: null,
        };
        room.players.push(newPlayer);

        const meta = socketMeta.get(socket.id)!;
        meta.roomId = room.id;
        meta.isSpectator = false;
        socket.join(room.id);

        const msg = store.addSystemChat(room, 'system', `${user.nickname}님이 입장했습니다.`);
        io.to(room.id).emit('chat:message', { message: msg });
        broadcastRoomUpdate(room);
        cb?.({ ok: true, room });
      }
    );

    socket.on('room:spectate', (payload: { roomId?: string; code?: string }, cb) => {
      const user = requireSocketUser(socket);
      if (!user) return cb?.({ ok: false, error: '먼저 닉네임과 PIN으로 인증해 주세요.' });

      let room: GameRoom | undefined;
      if (payload.roomId) room = store.rooms.get(payload.roomId);
      else if (payload.code) {
        const rid = store.roomsByCode.get(payload.code.trim().toUpperCase());
        if (rid) room = store.rooms.get(rid);
      }

      if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없습니다.' });
      if (!room.settings.allowSpectators) {
        return cb?.({ ok: false, error: '이 방은 관전이 허용되지 않습니다.' });
      }
      if (room.status !== 'playing') {
        return cb?.({ ok: false, error: '진행 중인 게임만 관전할 수 있습니다.' });
      }

      leaveCurrentRoom(socket, false);
      if (!room.spectators.some((s) => s.id === user.id)) {
        room.spectators.push({ id: user.id, nickname: user.nickname });
      }

      const meta = socketMeta.get(socket.id)!;
      meta.roomId = room.id;
      meta.isSpectator = true;
      socket.join(room.id);

      const state = store.gameStates.get(room.id);
      const msg = store.addSystemChat(room, 'system', `${user.nickname}님이 관전을 시작했습니다.`);
      io.to(room.id).emit('chat:message', { message: msg });
      broadcastRoomUpdate(room);

      cb?.({
        ok: true,
        room,
        isSpectator: true,
        state: state ? projectGameStateForViewer(state, user.id, true) : undefined,
      });
    });

    socket.on('room:leave', (payloadOrCb?: unknown, cb?: (res: any) => void) => {
      const callback = typeof payloadOrCb === 'function' ? (payloadOrCb as (res: any) => void) : cb;
      leaveCurrentRoom(socket, false);
      callback?.({ ok: true });
    });

    socket.on('room:toggle_ready', (payloadOrCb?: unknown, cb?: (res: any) => void) => {
      const callback = typeof payloadOrCb === 'function' ? (payloadOrCb as (res: any) => void) : cb;
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return callback?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.status !== 'waiting') return callback?.({ ok: false, error: '대기 중인 방이 아닙니다.' });

      const player = room.players.find((p) => p.id === user.id);
      if (!player) return callback?.({ ok: false, error: '플레이어를 찾을 수 없습니다.' });
      player.isReady = !player.isReady;
      broadcastRoomUpdate(room);
      callback?.({ ok: true, isReady: player.isReady });
    });

    socket.on('room:change_color', (payload: { color: RoomPlayer['color'] }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return cb?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.status !== 'waiting') return cb?.({ ok: false, error: '대기 중인 방이 아닙니다.' });
      if (!PLAYER_COLORS.includes(payload.color)) return cb?.({ ok: false, error: '잘못된 색상입니다.' });
      if (room.players.some((p) => p.id !== user.id && p.color === payload.color)) {
        return cb?.({ ok: false, error: '이미 다른 플레이어가 선택한 색상입니다.' });
      }
      const player = room.players.find((p) => p.id === user.id);
      if (!player) return cb?.({ ok: false, error: '플레이어를 찾을 수 없습니다.' });
      player.color = payload.color;
      broadcastRoomUpdate(room);
      cb?.({ ok: true });
    });

    // Host Controls
    socket.on('room:update_settings', (payload: { settings: Partial<RoomSettings> }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return cb?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 설정을 변경할 수 있습니다.' });
      if (room.status !== 'waiting') return cb?.({ ok: false, error: '게임 시작 전까지만 설정을 변경할 수 있습니다.' });

      const nextMax = payload.settings.maxPlayers ?? room.settings.maxPlayers;
      if (nextMax < room.players.length) {
        return cb?.({ ok: false, error: '현재 참가 인원보다 적게 설정할 수 없습니다.' });
      }

      room.settings = {
        ...room.settings,
        ...payload.settings,
        roomName: (payload.settings.roomName ?? room.settings.roomName).trim() || room.settings.roomName,
        maxPlayers: Math.min(4, Math.max(2, nextMax)),
      };
      broadcastRoomUpdate(room);
      cb?.({ ok: true, room });
    });

    socket.on('room:add_ai', (payload: { difficulty?: AIDifficulty }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return cb?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 AI를 추가할 수 있습니다.' });
      if (room.status !== 'waiting') return cb?.({ ok: false, error: '게임 시작 전까지만 AI를 추가할 수 있습니다.' });

      const added = addAIBotToRoom(room, payload?.difficulty);
      if (!added.ok) return cb?.(added);

      const msg = store.addSystemChat(room, 'system', 'AI 플레이어가 방에 추가되었습니다.');
      io.to(room.id).emit('chat:message', { message: msg });
      broadcastRoomUpdate(room);
      cb?.({ ok: true, room });
    });

    socket.on('room:remove_ai', (payload: { playerId: string }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return cb?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 AI를 제거할 수 있습니다.' });
      if (room.status !== 'waiting') return cb?.({ ok: false, error: '대기실에서만 제거할 수 있습니다.' });

      const target = room.players.find((p) => p.id === payload.playerId && p.isAI);
      if (!target) return cb?.({ ok: false, error: 'AI 플레이어를 찾을 수 없습니다.' });

      room.players = room.players.filter((p) => p.id !== payload.playerId);
      broadcastRoomUpdate(room);
      cb?.({ ok: true, room });
    });

    socket.on('room:kick_player', (payload: { playerId: string }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return cb?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 추방할 수 있습니다.' });
      if (room.status !== 'waiting') return cb?.({ ok: false, error: '게임 시작 전까지만 추방할 수 있습니다.' });
      if (payload.playerId === user.id) return cb?.({ ok: false, error: '자기 자신은 추방할 수 없습니다.' });

      const kicked = room.players.find((p) => p.id === payload.playerId);
      if (!kicked) return cb?.({ ok: false, error: '대상을 찾을 수 없습니다.' });

      room.players = room.players.filter((p) => p.id !== payload.playerId);

      // Disconnect kicked socket from room
      for (const [sid, m] of socketMeta.entries()) {
        if (m.userId === payload.playerId && m.roomId === room.id) {
          const s = io.sockets.sockets.get(sid);
          s?.leave(room.id);
          s?.emit('room:kicked', { roomId: room.id, reason: '방장에 의해 추방되었습니다.' });
          m.roomId = undefined;
        }
      }

      const msg = store.addSystemChat(room, 'system', `${kicked.nickname}님이 추방되었습니다.`);
      io.to(room.id).emit('chat:message', { message: msg });
      broadcastRoomUpdate(room);
      cb?.({ ok: true });
    });

    // Replace a disconnected human player with AI during an ongoing game (Requirement 21-10)
    socket.on('room:replace_disconnected_with_ai', (payload: { playerId: string }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return cb?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.hostId !== user.id) return cb?.({ ok: false, error: '방장만 AI 대체를 수행할 수 있습니다.' });
      if (room.status !== 'playing') return cb?.({ ok: false, error: '진행 중인 게임에서만 가능합니다.' });

      const rp = room.players.find((p) => p.id === payload.playerId);
      const state = store.gameStates.get(room.id);
      const gp = state?.players.find((p) => p.id === payload.playerId);
      if (!rp || !gp || rp.connected || rp.isAI) {
        return cb?.({ ok: false, error: '연결이 끊긴 인간 플레이어만 대체할 수 있습니다.' });
      }

      rp.isAI = true;
      rp.aiDifficulty = room.settings.aiDifficulty;
      rp.connected = true;
      rp.nickname = `${rp.nickname} (AI)`;
      gp.isAI = true;
      gp.aiDifficulty = room.settings.aiDifficulty;
      gp.connected = true;
      gp.nickname = rp.nickname;

      const msg = store.addSystemChat(
        room,
        'system',
        `${rp.nickname} 자리의 미접속으로 방장이 AI 대행으로 전환했습니다.`
      );
      io.to(room.id).emit('chat:message', { message: msg });
      broadcastRoomUpdate(room);
      broadcastGameState(room);
      scheduleAIIfNeeded(room);
      cb?.({ ok: true });
    });

    socket.on('room:start_game', (payloadOrCb?: unknown, cb?: (res: any) => void) => {
      const callback = typeof payloadOrCb === 'function' ? (payloadOrCb as (res: any) => void) : cb;
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) return callback?.({ ok: false, error: '방에 입장해 있지 않습니다.' });
      const room = store.rooms.get(meta.roomId);
      if (!room || room.hostId !== user.id) return callback?.({ ok: false, error: '방장만 게임을 시작할 수 있습니다.' });
      if (room.status !== 'waiting') return callback?.({ ok: false, error: '이미 시작된 방입니다.' });
      if (room.players.length < 2) {
        return callback?.({ ok: false, error: '최소 2명의 플레이어(또는 AI)가 필요합니다.' });
      }
      const unready = room.players.filter((p) => !p.isAI && !p.isHost && !p.isReady);
      if (unready.length > 0) {
        return callback?.({ ok: false, error: '모든 참가자가 준비 상태여야 게임을 시작할 수 있습니다.' });
      }

      startRoomGame(room);
      callback?.({ ok: true });
    });

    socket.on('game:action', (action: GameActionPayload, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) {
        return cb?.({ ok: false, error: '유효한 게임 세션이 아닙니다.' });
      }
      if (meta.isSpectator) {
        return cb?.({ ok: false, error: '관전자는 게임에 직접 개입할 수 없습니다.' });
      }
      const room = store.rooms.get(meta.roomId);
      const state = room ? store.gameStates.get(room.id) : undefined;
      if (!room || !state) {
        return cb?.({ ok: false, error: '진행 중인 게임을 찾을 수 없습니다.' });
      }

      const res = applyGameAction(state, user.id, action);
      if (!res.ok) {
        return cb?.({ ok: false, error: res.error });
      }
      if (res.duplicate) {
        return cb?.({ ok: true, duplicate: true });
      }

      handlePostAction(room, res.state, action);
      cb?.({ ok: true });
    });

    socket.on('chat:send', (payload: { text: string }, cb) => {
      const user = requireSocketUser(socket);
      const meta = socketMeta.get(socket.id);
      if (!user || !meta?.roomId) {
        return cb?.({ ok: false, error: '방에 입장한 상태에서만 채팅할 수 있습니다.' });
      }
      const room = store.rooms.get(meta.roomId);
      if (!room) return cb?.({ ok: false, error: '방을 찾을 수 없습니다.' });

      const mod = store.moderateChatMessage(user.id, payload?.text ?? '');
      if (!mod.ok) return cb?.({ ok: false, error: mod.error });

      const msg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        roomId: room.id,
        senderId: user.id,
        senderName: meta.isSpectator ? `${user.nickname} (관전)` : user.nickname,
        category: 'chat' as const,
        text: mod.text,
        timestamp: Date.now(),
      };
      room.chatMessages.push(msg);
      if (room.chatMessages.length > 200) {
        room.chatMessages = room.chatMessages.slice(-200);
      }
      io.to(room.id).emit('chat:message', { message: msg });
      cb?.({ ok: true });
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(socket, true);
      socketMeta.delete(socket.id);
    });
  });

  function cleanup() {
    for (const timer of aiTimers.values()) {
      clearTimeout(timer);
    }
    aiTimers.clear();
  }

  return { app, httpServer, io, store, cleanup };
}
