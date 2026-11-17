import crypto from 'node:crypto';
import {
  ChatMessage,
  GameRecord,
  GameRoom,
  GameState,
  PLAYER_COLORS,
  PublicRoomSummary,
  RoomSettings,
  UserProfile,
} from '../shared/types';

export interface StoredUser {
  id: string;
  nickname: string;
  pinHash: string;
  pinSalt: string;
  createdAt: number;
  sessionToken: string;
}

const BAD_WORDS = [
  '시발',
  '씨발',
  '병신',
  '개새끼',
  '존나',
  '지랄',
  'fuck',
  'shit',
  'bitch',
  'asshole',
];

export class InMemoryStore {
  users = new Map<string, StoredUser>();
  usersByNickname = new Map<string, string>();
  sessions = new Map<string, string>(); // token -> userId
  rooms = new Map<string, GameRoom>();
  roomsByCode = new Map<string, string>();
  gameStates = new Map<string, GameState>();
  gameRecords: GameRecord[] = [];
  chatTimestamps = new Map<string, number[]>(); // userId -> timestamps

  private hashPin(pin: string, salt: string): string {
    return crypto.scryptSync(pin, salt, 32).toString('hex');
  }

  private verifyPin(pin: string, salt: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashPin(pin, salt), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  }

  registerOrLogin(
    rawNickname: string,
    rawPin: string
  ): { ok: true; user: UserProfile; sessionToken: string; isNew: boolean } | { ok: false; error: string } {
    const nickname = rawNickname.trim();
    const pin = rawPin.trim();

    if (nickname.length < 2 || nickname.length > 14) {
      return { ok: false, error: '닉네임은 2~14자로 입력해 주세요.' };
    }
    if (!/^\d{4}$/.test(pin)) {
      return { ok: false, error: 'PIN 비밀번호는 숫자 4자리여야 합니다.' };
    }

    const key = nickname.toLowerCase();
    const existingId = this.usersByNickname.get(key);

    if (existingId) {
      const stored = this.users.get(existingId)!;
      if (!this.verifyPin(pin, stored.pinSalt, stored.pinHash)) {
        return { ok: false, error: '이미 사용 중인 닉네임이거나 4자리 PIN이 일치하지 않습니다.' };
      }
      // Refresh session token
      this.sessions.delete(stored.sessionToken);
      const newToken = crypto.randomUUID();
      stored.sessionToken = newToken;
      this.sessions.set(newToken, stored.id);
      return {
        ok: true,
        isNew: false,
        sessionToken: newToken,
        user: { id: stored.id, nickname: stored.nickname, createdAt: stored.createdAt },
      };
    }

    const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const pinHash = this.hashPin(pin, salt);
    const sessionToken = crypto.randomUUID();
    const createdAt = Date.now();

    const stored: StoredUser = {
      id,
      nickname,
      pinHash,
      pinSalt: salt,
      createdAt,
      sessionToken,
    };

    this.users.set(id, stored);
    this.usersByNickname.set(key, id);
    this.sessions.set(sessionToken, id);

    return {
      ok: true,
      isNew: true,
      sessionToken,
      user: { id, nickname, createdAt },
    };
  }

  getUserByToken(token: string | undefined): UserProfile | null {
    if (!token) return null;
    const userId = this.sessions.get(token);
    if (!userId) return null;
    const u = this.users.get(userId);
    if (!u) return null;
    return { id: u.id, nickname: u.nickname, createdAt: u.createdAt };
  }

  generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.roomsByCode.has(code)) return code;
    }
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  createRoom(
    host: UserProfile,
    mode: GameRoom['mode'],
    partialSettings: Partial<RoomSettings>
  ): GameRoom {
    const id = `room_${crypto.randomUUID().slice(0, 10)}`;
    const code = this.generateRoomCode();
    const settings: RoomSettings = {
      roomName: partialSettings.roomName?.trim() || `${host.nickname}의 선술집 방`,
      isPublic: partialSettings.isPublic ?? true,
      maxPlayers: Math.min(4, Math.max(2, partialSettings.maxPlayers ?? 4)),
      allowAI: partialSettings.allowAI ?? true,
      aiDifficulty: partialSettings.aiDifficulty ?? 'normal',
      boardMode: partialSettings.boardMode ?? 'random',
      victoryPointsTarget: partialSettings.victoryPointsTarget ?? 10,
      restrictJoinDuringGame: partialSettings.restrictJoinDuringGame ?? true,
      allowSpectators: partialSettings.allowSpectators ?? true,
    };

    const room: GameRoom = {
      id,
      code,
      hostId: host.id,
      mode,
      status: 'waiting',
      settings,
      players: [
        {
          id: host.id,
          nickname: host.nickname,
          color: PLAYER_COLORS[0],
          isAI: false,
          isReady: true,
          isHost: true,
          connected: true,
          seatOrder: 0,
          disconnectedAt: null,
        },
      ],
      spectators: [],
      chatMessages: [],
      createdAt: Date.now(),
    };

    this.rooms.set(id, room);
    this.roomsByCode.set(code, id);
    return room;
  }

  listPublicRooms(): PublicRoomSummary[] {
    const list: PublicRoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (!room.settings.isPublic) continue;
      if (room.mode !== 'multiplayer') continue;
      if (room.status === 'finished') continue;
      const host = room.players.find((p) => p.id === room.hostId) ?? room.players[0];
      list.push({
        id: room.id,
        code: room.code,
        roomName: room.settings.roomName,
        hostName: host?.nickname ?? '방장',
        playerCount: room.players.length,
        maxPlayers: room.settings.maxPlayers,
        status: room.status,
        isPublic: room.settings.isPublic,
        allowSpectators: room.settings.allowSpectators,
        aiDifficulty: room.settings.aiDifficulty,
        victoryPointsTarget: room.settings.victoryPointsTarget,
      });
    }
    return list.sort((a, b) => (a.status === 'waiting' ? -1 : 1) - (b.status === 'waiting' ? -1 : 1));
  }

  moderateChatMessage(
    userId: string,
    rawText: string
  ): { ok: true; text: string } | { ok: false; error: string } {
    const trimmed = rawText.trim();
    if (!trimmed) return { ok: false, error: '메시지를 입력하세요.' };
    if (trimmed.length > 200) {
      return { ok: false, error: '채팅은 200자 이하로 입력해 주세요.' };
    }

    const now = Date.now();
    const recent = (this.chatTimestamps.get(userId) ?? []).filter((t) => now - t < 5000);
    if (recent.length >= 4) {
      return { ok: false, error: '도배 방지를 위해 잠시 후 다시 입력해 주세요.' };
    }
    if (recent.length > 0 && now - recent[recent.length - 1] < 400) {
      return { ok: false, error: '메시지를 너무 빠르게 보내고 있습니다.' };
    }
    recent.push(now);
    this.chatTimestamps.set(userId, recent);

    let filtered = trimmed;
    for (const bad of BAD_WORDS) {
      const regex = new RegExp(bad, 'gi');
      filtered = filtered.replace(regex, '***');
    }
    return { ok: true, text: filtered };
  }

  addSystemChat(
    room: GameRoom,
    category: ChatMessage['category'],
    text: string
  ): ChatMessage {
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      roomId: room.id,
      senderId: 'system',
      senderName: '시스템',
      category,
      text,
      timestamp: Date.now(),
    };
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 200) {
      room.chatMessages = room.chatMessages.slice(-200);
    }
    return msg;
  }

  saveGameRecord(room: GameRoom, state: GameState): GameRecord {
    const existing = this.gameRecords.find((r) => r.id === state.id);
    if (existing) return existing;

    const sortedPlayers = [...state.players].sort((a, b) => b.totalVP - a.totalVP);
    const winner = state.players.find((p) => p.id === state.winnerId) ?? sortedPlayers[0];

    const record: GameRecord = {
      id: state.id,
      roomId: room.id,
      roomName: room.settings.roomName,
      mode: room.mode,
      winnerId: winner.id,
      winnerNickname: winner.nickname,
      players: sortedPlayers.map((p, idx) => ({
        playerId: p.id,
        nickname: p.nickname,
        color: p.color,
        isAI: p.isAI,
        finalVP: p.totalVP,
        rank: idx + 1,
      })),
      startedAt: state.startedAt,
      endedAt: state.endedAt ?? Date.now(),
      turnCount: state.turnNumber,
    };

    this.gameRecords.unshift(record);
    if (this.gameRecords.length > 100) {
      this.gameRecords = this.gameRecords.slice(0, 100);
    }
    return record;
  }
}
