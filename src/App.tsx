/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AIDifficulty,
  BoardMode,
  ChatMessage,
  ClientGameState,
  GameActionPayload,
  GameRecord,
  GameRoom,
  PlayerColor,
  PublicRoomSummary,
  RoomSettings,
  UserProfile,
} from './shared/types';
import { AppScreen, ClientSettings, DEFAULT_CLIENT_SETTINGS } from './types/client';
import { TitleScreen } from './components/TitleScreen';
import { MultiplayerHub } from './components/MultiplayerHub';
import { WaitingLobby } from './components/WaitingLobby';
import { GameView } from './components/GameView';
import { RecordsView, SettingsView } from './components/RecordsAndSettings';
import { soundFX } from './utils/sound';

function emitAck<T = { ok: boolean; error?: string }>(
  socket: Socket,
  event: string,
  payload?: unknown
): Promise<T> {
  return new Promise((resolve) => {
    if (payload === undefined) {
      socket.emit(event, (res: T) => resolve(res));
    } else {
      socket.emit(event, payload, (res: T) => resolve(res));
    }
  });
}

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const [screen, setScreen] = useState<AppScreen>('TITLE');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('catan_session_token');
    } catch {
      return null;
    }
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [currentRoom, setCurrentRoom] = useState<GameRoom | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [records, setRecords] = useState<GameRecord[]>([]);

  const [hubError, setHubError] = useState<string | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [settings, setSettings] = useState<ClientSettings>(DEFAULT_CLIENT_SETTINGS);

  const lastRoomCodeRef = useRef<string | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const autostartDoneRef = useRef(false);

  // Sync body[data-state] for game shell & accessibility
  useEffect(() => {
    if (screen === 'PLAYING') {
      document.body.dataset.state = gameState?.phase === 'GAME_OVER' ? 'gameover' : 'playing';
    } else if (screen === 'TITLE') {
      document.body.dataset.state = 'title';
    } else {
      document.body.dataset.state = 'menu';
    }
  }, [screen, gameState?.phase]);

  useEffect(() => {
    soundFX.muted = !settings.soundEnabled;
  }, [settings.soundEnabled]);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch('/api/records');
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records ?? []);
      }
    } catch {
      // ignore transient errors
    }
  }, []);

  // Initialize Socket.IO connection
  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', async () => {
      setSocketConnected(true);
      const savedToken = (() => {
        try {
          return sessionStorage.getItem('catan_session_token');
        } catch {
          return null;
        }
      })();
      if (savedToken) {
        const res = await emitAck<{
          ok: boolean;
          user?: UserProfile;
          sessionToken?: string;
        }>(socket, 'auth:authenticate', { sessionToken: savedToken });
        if (res.ok && res.user) {
          setUser(res.user);
          setSessionToken(res.sessionToken ?? savedToken);
          // Attempt automatic rejoin if previously in a room
          if (lastRoomCodeRef.current) {
            const rejoin = await emitAck<{
              ok: boolean;
              room?: GameRoom;
              state?: ClientGameState;
            }>(socket, 'room:join', { code: lastRoomCodeRef.current });
            if (rejoin.ok && rejoin.room) {
              activeRoomIdRef.current = rejoin.room.id;
              setCurrentRoom(rejoin.room);
              setChatMessages(rejoin.room.chatMessages ?? []);
              if (rejoin.state) {
                setGameState(rejoin.state);
                setScreen('PLAYING');
              }
            }
          }
        }
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('rooms:list', (data: { rooms: PublicRoomSummary[] }) => {
      setPublicRooms(data.rooms ?? []);
    });

    socket.on('room:update', (data: { room: GameRoom }) => {
      if (activeRoomIdRef.current && data.room.id !== activeRoomIdRef.current) return;
      if (!activeRoomIdRef.current && !lastRoomCodeRef.current) return;
      setCurrentRoom(data.room);
      lastRoomCodeRef.current = data.room.code;
      activeRoomIdRef.current = data.room.id;
      if (data.room.chatMessages) {
        setChatMessages(data.room.chatMessages);
      }
    });

    socket.on('game:state', (data: { state: ClientGameState }) => {
      if (!activeRoomIdRef.current || data.state.roomId !== activeRoomIdRef.current) return;
      setGameState((prev) => {
        if (data.state.phase === 'GAME_OVER' && prev?.phase !== 'GAME_OVER') {
          soundFX.victory();
        }
        return data.state;
      });
      setScreen('PLAYING');
    });

    socket.on('chat:message', (data: { message: ChatMessage }) => {
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev.slice(-199), data.message];
      });
    });

    socket.on('room:kicked', (data: { reason: string }) => {
      setCurrentRoom(null);
      setGameState(null);
      lastRoomCodeRef.current = null;
      setHubError(data.reason || '방에서 퇴장되었습니다.');
      setScreen('MULTIPLAYER_HUB');
    });

    socket.on('game:ended', () => {
      fetchRecords();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchRecords]);

  const authenticateUser = useCallback(
    async (nickname: string, pin: string): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket) return false;
      setAuthLoading(true);
      setAuthError(null);
      const res = await emitAck<{
        ok: boolean;
        user?: UserProfile;
        sessionToken?: string;
        error?: string;
      }>(socket, 'auth:authenticate', { nickname, pin });
      setAuthLoading(false);

      if (!res.ok || !res.user || !res.sessionToken) {
        setAuthError(res.error ?? '인증에 실패했습니다.');
        return false;
      }

      setUser(res.user);
      setSessionToken(res.sessionToken);
      try {
        sessionStorage.setItem('catan_session_token', res.sessionToken);
      } catch {
        // ignore storage errors
      }
      return true;
    },
    []
  );

  const ensureAuthenticated = useCallback(async (): Promise<boolean> => {
    if (user && sessionToken) return true;
    const guestSuffix = Math.floor(100 + Math.random() * 899);
    return authenticateUser(`개척자${guestSuffix}`, '1234');
  }, [user, sessionToken, authenticateUser]);

  const handleStartQuickGame = useCallback(
    async (
      mode: 'single' | 'ai',
      aiCount = 3,
      aiDifficulty: AIDifficulty = settings.defaultDifficulty,
      boardMode: BoardMode = settings.defaultBoardMode,
      victoryPointsTarget = settings.defaultVictoryPoints
    ) => {
      const authed = await ensureAuthenticated();
      if (!authed || !socketRef.current) return;
      soundFX.click();

      const res = await emitAck<{
        ok: boolean;
        room?: GameRoom;
        state?: ClientGameState;
        error?: string;
      }>(socketRef.current, 'game:quick_start', {
        mode,
        aiCount,
        aiDifficulty,
        boardMode,
        victoryPointsTarget,
      });

      if (res.ok && res.room && res.state) {
        setCurrentRoom(res.room);
        lastRoomCodeRef.current = res.room.code;
        activeRoomIdRef.current = res.room.id;
        setChatMessages(res.room.chatMessages ?? []);
        setGameState(res.state);
        setScreen('PLAYING');
      } else {
        setAuthError(res.error ?? '게임을 시작하지 못했습니다.');
      }
    },
    [ensureAuthenticated, settings]
  );

  // Handle URL query params (?autostart=1 and ?room=XXXXXX)
  useEffect(() => {
    if (!socketConnected || autostartDoneRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart');
    const roomParam = params.get('room');

    if (autostart === '1') {
      autostartDoneRef.current = true;
      handleStartQuickGame('single');
    } else if (roomParam) {
      autostartDoneRef.current = true;
      setInitialRoomCode(roomParam.toUpperCase());
      ensureAuthenticated().then(() => {
        setScreen('MULTIPLAYER_HUB');
      });
    }
  }, [socketConnected, handleStartQuickGame, ensureAuthenticated]);

  const handleOpenMultiplayer = async () => {
    const authed = await ensureAuthenticated();
    if (!authed || !socketRef.current) return;
    soundFX.click();
    setHubError(null);
    const res = await emitAck<{ ok: boolean; rooms?: PublicRoomSummary[] }>(
      socketRef.current,
      'rooms:fetch'
    );
    if (res.ok && res.rooms) setPublicRooms(res.rooms);
    setScreen('MULTIPLAYER_HUB');
  };

  const handleRefreshRooms = async () => {
    if (!socketRef.current) return;
    const res = await emitAck<{ ok: boolean; rooms?: PublicRoomSummary[] }>(
      socketRef.current,
      'rooms:fetch'
    );
    if (res.ok && res.rooms) setPublicRooms(res.rooms);
  };

  const handleCreateRoom = async (roomSettings: Partial<RoomSettings>) => {
    if (!socketRef.current) return;
    setHubError(null);
    const res = await emitAck<{ ok: boolean; room?: GameRoom; error?: string }>(
      socketRef.current,
      'room:create',
      { settings: roomSettings }
    );
    if (!res.ok || !res.room) {
      setHubError(res.error ?? '방 생성에 실패했습니다.');
      return;
    }
    soundFX.click();
    setCurrentRoom(res.room);
    lastRoomCodeRef.current = res.room.code;
    activeRoomIdRef.current = res.room.id;
    setChatMessages(res.room.chatMessages ?? []);
    setLobbyError(null);
    setScreen('LOBBY');
  };

  const handleJoinRoom = async (target: { roomId?: string; code?: string }) => {
    if (!socketRef.current) return;
    setHubError(null);
    const res = await emitAck<{
      ok: boolean;
      room?: GameRoom;
      state?: ClientGameState;
      error?: string;
    }>(socketRef.current, 'room:join', target);
    if (!res.ok || !res.room) {
      setHubError(res.error ?? '방 입장에 실패했습니다.');
      return;
    }
    soundFX.click();
    setCurrentRoom(res.room);
    lastRoomCodeRef.current = res.room.code;
    activeRoomIdRef.current = res.room.id;
    setChatMessages(res.room.chatMessages ?? []);
    if (res.state) {
      setGameState(res.state);
      setScreen('PLAYING');
    } else {
      setLobbyError(null);
      setScreen('LOBBY');
    }
  };

  const handleSpectateRoom = async (target: { roomId?: string; code?: string }) => {
    if (!socketRef.current) return;
    setHubError(null);
    const res = await emitAck<{
      ok: boolean;
      room?: GameRoom;
      state?: ClientGameState;
      error?: string;
    }>(socketRef.current, 'room:spectate', target);
    if (!res.ok || !res.room || !res.state) {
      setHubError(res.error ?? '관전 입장에 실패했습니다.');
      return;
    }
    soundFX.click();
    setCurrentRoom(res.room);
    lastRoomCodeRef.current = res.room.code;
    activeRoomIdRef.current = res.room.id;
    setChatMessages(res.room.chatMessages ?? []);
    setGameState(res.state);
    setScreen('PLAYING');
  };

  const handleDispatchGameAction = async (action: GameActionPayload) => {
    if (!socketRef.current) return;
    setActionError(null);

    if (action.type === 'ROLL_DICE') soundFX.dice();
    else if (
      action.type === 'BUILD_ROAD' ||
      action.type === 'BUILD_SETTLEMENT' ||
      action.type === 'UPGRADE_CITY' ||
      action.type === 'PLACE_SETUP_SETTLEMENT' ||
      action.type === 'PLACE_SETUP_ROAD'
    ) {
      soundFX.build();
    } else if (action.type === 'BANK_TRADE' || action.type === 'ACCEPT_TRADE') {
      soundFX.trade();
    } else if (action.type === 'MOVE_ROBBER' || action.type === 'STEAL_RESOURCE') {
      soundFX.robber();
    } else {
      soundFX.click();
    }

    const res = await emitAck<{ ok: boolean; error?: string }>(
      socketRef.current,
      'game:action',
      action
    );
    if (!res.ok) {
      soundFX.error();
      setActionError(res.error ?? '행동을 처리할 수 없습니다.');
      setTimeout(() => setActionError(null), 3500);
    }
  };

  const handleLeaveRoomOrGame = () => {
    soundFX.click();
    lastRoomCodeRef.current = null;
    activeRoomIdRef.current = null;
    setCurrentRoom(null);
    setGameState(null);
    setChatMessages([]);
    setActionError(null);
    setLobbyError(null);
    setScreen('TITLE');
    if (socketRef.current?.connected) {
      socketRef.current.emit('room:leave');
    }
  };

  const handleSendChat = async (text: string) => {
    if (!socketRef.current) return;
    const res = await emitAck<{ ok: boolean; error?: string }>(
      socketRef.current,
      'chat:send',
      { text }
    );
    if (!res.ok && res.error) {
      setActionError(res.error);
      setLobbyError(res.error);
      setTimeout(() => {
        setActionError(null);
        setLobbyError(null);
      }, 3000);
    }
  };

  const handleManualReconnect = () => {
    if (socketRef.current) {
      socketRef.current.connect();
    }
  };

  if (screen === 'PLAYING' && currentRoom && gameState) {
    return (
      <GameView
        room={currentRoom}
        state={gameState}
        chatMessages={chatMessages}
        socketConnected={socketConnected}
        muted={!settings.soundEnabled}
        actionError={actionError}
        onToggleMute={() =>
          setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }))
        }
        onDispatchAction={handleDispatchGameAction}
        onSendChat={handleSendChat}
        onReconnect={handleManualReconnect}
        onReplaceDisconnectedWithAI={async (playerId) => {
          if (!socketRef.current) return;
          await emitAck(socketRef.current, 'room:replace_disconnected_with_ai', {
            playerId,
          });
        }}
        onLeaveGame={handleLeaveRoomOrGame}
        onPlayAgain={
          currentRoom.mode !== 'multiplayer'
            ? () =>
                handleStartQuickGame(
                  currentRoom.mode === 'single' ? 'single' : 'ai',
                  currentRoom.players.length - 1,
                  currentRoom.settings.aiDifficulty,
                  currentRoom.settings.boardMode,
                  currentRoom.settings.victoryPointsTarget
                )
            : undefined
        }
      />
    );
  }

  if (screen === 'LOBBY' && currentRoom && user) {
    return (
      <WaitingLobby
        room={currentRoom}
        currentUserId={user.id}
        chatMessages={chatMessages}
        errorMsg={lobbyError}
        onToggleReady={async () => {
          if (!socketRef.current) return;
          await emitAck(socketRef.current, 'room:toggle_ready');
        }}
        onChangeColor={async (color: PlayerColor) => {
          if (!socketRef.current) return;
          const res = await emitAck<{ ok: boolean; error?: string }>(
            socketRef.current,
            'room:change_color',
            { color }
          );
          if (!res.ok) setLobbyError(res.error ?? null);
        }}
        onAddAI={async (difficulty) => {
          if (!socketRef.current) return;
          const res = await emitAck<{ ok: boolean; error?: string }>(
            socketRef.current,
            'room:add_ai',
            { difficulty }
          );
          if (!res.ok) setLobbyError(res.error ?? null);
        }}
        onRemoveAI={async (playerId) => {
          if (!socketRef.current) return;
          await emitAck(socketRef.current, 'room:remove_ai', { playerId });
        }}
        onKickPlayer={async (playerId) => {
          if (!socketRef.current) return;
          await emitAck(socketRef.current, 'room:kick_player', { playerId });
        }}
        onUpdateSettings={async (nextSettings) => {
          if (!socketRef.current) return;
          const res = await emitAck<{ ok: boolean; error?: string }>(
            socketRef.current,
            'room:update_settings',
            { settings: nextSettings }
          );
          if (!res.ok) setLobbyError(res.error ?? null);
        }}
        onStartGame={async () => {
          if (!socketRef.current) return;
          const res = await emitAck<{ ok: boolean; error?: string }>(
            socketRef.current,
            'room:start_game'
          );
          if (!res.ok) setLobbyError(res.error ?? null);
        }}
        onLeaveRoom={handleLeaveRoomOrGame}
        onSendChat={handleSendChat}
      />
    );
  }

  if (screen === 'MULTIPLAYER_HUB') {
    return (
      <MultiplayerHub
        user={user}
        publicRooms={publicRooms}
        initialJoinCode={initialRoomCode}
        errorMsg={hubError}
        onBack={() => setScreen('TITLE')}
        onRefreshRooms={handleRefreshRooms}
        onCreateRoom={handleCreateRoom}
        onJoinRoomById={(roomId) => handleJoinRoom({ roomId })}
        onJoinRoomByCode={(code) => handleJoinRoom({ code })}
        onSpectateRoom={handleSpectateRoom}
      />
    );
  }

  if (screen === 'RECORDS') {
    return (
      <RecordsView
        records={records}
        onRefresh={fetchRecords}
        onBack={() => setScreen('TITLE')}
      />
    );
  }

  if (screen === 'SETTINGS') {
    return (
      <SettingsView
        settings={settings}
        onChange={setSettings}
        onBack={() => setScreen('TITLE')}
      />
    );
  }

  return (
    <TitleScreen
      user={user}
      authError={authError}
      authLoading={authLoading}
      onAuthenticate={authenticateUser}
      onStartSingle={() => handleStartQuickGame('single', 3)}
      onStartAI={(aiCount, diff, board, vp) =>
        handleStartQuickGame('ai', aiCount, diff, board, vp)
      }
      onOpenMultiplayer={handleOpenMultiplayer}
      onOpenRecords={() => {
        fetchRecords();
        setScreen('RECORDS');
      }}
      onOpenSettings={() => setScreen('SETTINGS')}
      defaultDifficulty={settings.defaultDifficulty}
      defaultBoardMode={settings.defaultBoardMode}
      defaultVictoryPoints={settings.defaultVictoryPoints}
    />
  );
}
