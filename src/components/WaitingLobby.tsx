import React, { useState } from 'react';
import {
  AIDifficulty,
  BoardMode,
  ChatMessage,
  GameRoom,
  PLAYER_COLOR_HEX,
  PLAYER_COLORS,
  PlayerColor,
  RoomSettings,
} from '../shared/types';
import { Bot, Check, Copy, Crown, LogOut, Play, Send, Shield, UserMinus } from 'lucide-react';

interface WaitingLobbyProps {
  room: GameRoom;
  currentUserId: string;
  chatMessages: ChatMessage[];
  errorMsg: string | null;
  onToggleReady: () => void;
  onChangeColor: (color: PlayerColor) => void;
  onAddAI: (difficulty: AIDifficulty) => void;
  onRemoveAI: (playerId: string) => void;
  onKickPlayer: (playerId: string) => void;
  onUpdateSettings: (settings: Partial<RoomSettings>) => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onSendChat: (text: string) => void;
}

export const WaitingLobby: React.FC<WaitingLobbyProps> = ({
  room,
  currentUserId,
  chatMessages,
  errorMsg,
  onToggleReady,
  onChangeColor,
  onAddAI,
  onRemoveAI,
  onKickPlayer,
  onUpdateSettings,
  onStartGame,
  onLeaveRoom,
  onSendChat,
}) => {
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);
  const [chatInput, setChatInput] = useState('');

  const isHost = room.hostId === currentUserId;
  const me = room.players.find((p) => p.id === currentUserId);
  const allReady =
    room.players.length >= 2 &&
    room.players.every((p) => p.isAI || p.isHost || p.isReady);

  const copyCode = () => {
    navigator.clipboard?.writeText(room.code).catch(() => {});
    setCopiedType('code');
    setTimeout(() => setCopiedType(null), 2000);
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin}/?room=${room.code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedType('link');
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 md:p-6">
      <div className="w-full max-w-6xl flex flex-col gap-4">
        {/* Header with Room Code & Invite Links */}
        <header className="pixel-panel px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-[#fef3c7]">{room.settings.roomName}</h1>
              <span className="text-xs text-[#b8a38d]">
                {room.settings.isPublic ? '공개 방' : '비공개 방'} · 목표 {room.settings.victoryPointsTarget}점
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#d6c3a5]">
              <span>방 코드:</span>
              <strong className="font-pixel-en text-sm text-[#eab308] tracking-widest tabular-nums">
                {room.code}
              </strong>
              <button
                type="button"
                onClick={copyCode}
                className="pixel-btn px-2.5 py-1 bg-[#36251c] text-[#f5ead8] text-xs flex items-center gap-1 cursor-pointer"
              >
                {copiedType === 'code' ? <Check className="w-3 h-3 text-[#4ade80]" /> : <Copy className="w-3 h-3" />}
                {copiedType === 'code' ? '복사됨' : '코드 복사'}
              </button>
              <button
                type="button"
                onClick={copyInviteLink}
                className="pixel-btn px-2.5 py-1 bg-[#36251c] text-[#f5ead8] text-xs flex items-center gap-1 cursor-pointer"
              >
                {copiedType === 'link' ? <Check className="w-3 h-3 text-[#4ade80]" /> : <Copy className="w-3 h-3" />}
                {copiedType === 'link' ? '링크 복사됨' : '초대 링크 복사'}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onLeaveRoom}
            className="pixel-btn px-4 py-2 bg-[#7f1d1d] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" /> 방 나가기
          </button>
        </header>

        {errorMsg && (
          <div role="alert" className="pixel-panel-dark bg-[#450a0a] border-[#991b1b] px-4 py-2.5 text-sm text-[#fca5a5]">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Players & Color/Ready & Host Controls */}
          <section className="lg:col-span-7 flex flex-col gap-4">
            <div className="pixel-panel p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#fef3c7]">
                  참가자 대기실 ({room.players.length} / {room.settings.maxPlayers})
                </h2>
                {isHost && room.settings.allowAI && room.players.length < room.settings.maxPlayers && (
                  <button
                    type="button"
                    onClick={() => onAddAI(room.settings.aiDifficulty)}
                    className="pixel-btn px-3 py-1.5 bg-[#1d4ed8] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5" /> + AI 추가
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2.5">
                {room.players.map((p) => {
                  const palette = PLAYER_COLOR_HEX[p.color];
                  const isSelf = p.id === currentUserId;
                  return (
                    <div
                      key={p.id}
                      className="pixel-panel-dark px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-5 h-5 border-2 border-[#0d0806] shrink-0"
                          style={{ backgroundColor: palette.primary }}
                          title={palette.label}
                        />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 text-sm font-bold text-[#fef3c7]">
                            <span>{p.nickname}</span>
                            {p.isHost && (
                              <span className="inline-flex items-center gap-1 text-xs text-[#eab308]">
                                <Crown className="w-3.5 h-3.5" /> 방장
                              </span>
                            )}
                            {p.isAI && (
                              <span className="inline-flex items-center gap-1 text-xs text-[#60a5fa]">
                                <Bot className="w-3.5 h-3.5" /> AI ({p.aiDifficulty})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#b8a38d]">
                            {p.connected ? '연결됨' : '연결 끊김'} · {palette.label}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isSelf && (
                          <div className="flex items-center gap-1 mr-2" aria-label="색상 선택">
                            {PLAYER_COLORS.map((c) => {
                              const taken = room.players.some((op) => op.id !== p.id && op.color === c);
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  disabled={taken}
                                  onClick={() => onChangeColor(c)}
                                  aria-label={`${PLAYER_COLOR_HEX[c].label} 선택`}
                                  className={`w-5 h-5 border-2 cursor-pointer ${
                                    p.color === c ? 'border-white scale-110' : 'border-[#0d0806]'
                                  } ${taken ? 'opacity-25 cursor-not-allowed' : ''}`}
                                  style={{ backgroundColor: PLAYER_COLOR_HEX[c].primary }}
                                />
                              );
                            })}
                          </div>
                        )}

                        <span
                          className={`text-xs font-bold px-2 py-1 border ${
                            p.isReady || p.isHost
                              ? 'text-[#4ade80] border-[#166534] bg-[#052e16]'
                              : 'text-[#facc15] border-[#854d0e] bg-[#422006]'
                          }`}
                        >
                          {p.isHost ? '방장' : p.isReady ? '준비 완료' : '대기 중'}
                        </span>

                        {isHost && !p.isHost && (
                          <button
                            type="button"
                            onClick={() => (p.isAI ? onRemoveAI(p.id) : onKickPlayer(p.id))}
                            aria-label={`${p.nickname} 내보내기`}
                            className="pixel-btn p-1.5 bg-[#7f1d1d] text-white cursor-pointer"
                            title={p.isAI ? 'AI 제거' : '플레이어 추방'}
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ready & Start Actions */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                {!isHost && me && (
                  <button
                    type="button"
                    onClick={onToggleReady}
                    className={`pixel-btn px-5 py-2.5 font-bold text-sm cursor-pointer ${
                      me.isReady ? 'bg-[#36251c] text-[#f5ead8]' : 'bg-[#15803d] text-white'
                    }`}
                  >
                    {me.isReady ? '준비 해제' : '게임 준비 완료'}
                  </button>
                )}

                {isHost && (
                  <button
                    type="button"
                    disabled={!allReady}
                    onClick={onStartGame}
                    className="pixel-btn px-6 py-3 bg-[#b45309] text-white font-bold text-sm flex items-center gap-2 cursor-pointer ml-auto"
                  >
                    <Play className="w-4 h-4" />
                    {room.players.length < 2
                      ? '최소 2명(또는 AI)이 필요합니다'
                      : allReady
                        ? '게임 시작 (순서 무작위 배정)'
                        : '모든 참가자가 준비해야 시작 가능'}
                  </button>
                )}
              </div>
            </div>

            {/* Host Live Settings Panel (Requirement 21-3) */}
            {isHost && (
              <div className="pixel-panel p-5 flex flex-col gap-3">
                <h3 className="text-sm font-bold text-[#eab308] flex items-center gap-2">
                  <Shield className="w-4 h-4" /> 방장 게임 설정
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-[#d6c3a5]">
                  <label className="flex flex-col gap-1">
                    공개 여부
                    <select
                      value={room.settings.isPublic ? 'public' : 'private'}
                      onChange={(e) => onUpdateSettings({ isPublic: e.target.value === 'public' })}
                      className="pixel-input px-2 py-1.5"
                    >
                      <option value="public">공개</option>
                      <option value="private">비공개</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    AI 난이도
                    <select
                      value={room.settings.aiDifficulty}
                      onChange={(e) =>
                        onUpdateSettings({ aiDifficulty: e.target.value as AIDifficulty })
                      }
                      className="pixel-input px-2 py-1.5"
                    >
                      <option value="easy">쉬움</option>
                      <option value="normal">보통</option>
                      <option value="hard">어려움</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    게임판
                    <select
                      value={room.settings.boardMode}
                      onChange={(e) =>
                        onUpdateSettings({ boardMode: e.target.value as BoardMode })
                      }
                      className="pixel-input px-2 py-1.5"
                    >
                      <option value="random">무작위</option>
                      <option value="standard">표준</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    승리 점수
                    <select
                      value={room.settings.victoryPointsTarget}
                      onChange={(e) =>
                        onUpdateSettings({ victoryPointsTarget: Number(e.target.value) })
                      }
                      className="pixel-input px-2 py-1.5"
                    >
                      <option value={8}>8점</option>
                      <option value={10}>10점</option>
                      <option value={12}>12점</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
          </section>

          {/* Right: Lobby Chat */}
          <aside className="lg:col-span-5 pixel-panel p-4 flex flex-col h-[460px]">
            <h2 className="text-sm font-bold text-[#fef3c7] mb-3">대기실 채팅</h2>
            <div className="flex-1 pixel-panel-dark p-3 overflow-y-auto pixel-scroll flex flex-col gap-2 text-xs">
              {chatMessages.map((m) => (
                <div key={m.id} className="leading-relaxed">
                  {m.category === 'chat' ? (
                    <span>
                      <strong className="text-[#eab308]">{m.senderName}:</strong>{' '}
                      <span className="text-[#f5ead8]">{m.text}</span>
                    </span>
                  ) : (
                    <span className="text-[#93c5fd]">[알림] {m.text}</span>
                  )}
                </div>
              ))}
            </div>
            <form onSubmit={handleChatSubmit} className="mt-3 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={200}
                placeholder="대기실 채팅 입력..."
                className="pixel-input px-3 py-2 text-xs flex-1"
              />
              <button
                type="submit"
                aria-label="채팅 전송"
                className="pixel-btn px-3 py-2 bg-[#b45309] text-white cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </aside>
        </div>
      </div>
    </div>
  );
};
