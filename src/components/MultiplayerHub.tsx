import React, { useState } from 'react';
import {
  AIDifficulty,
  BoardMode,
  PublicRoomSummary,
  RoomSettings,
  UserProfile,
} from '../shared/types';
import { ArrowLeft, Copy, Eye, Lock, Plus, RefreshCw, Search, Users } from 'lucide-react';

interface MultiplayerHubProps {
  user: UserProfile | null;
  publicRooms: PublicRoomSummary[];
  initialJoinCode?: string;
  errorMsg: string | null;
  onBack: () => void;
  onRefreshRooms: () => void;
  onCreateRoom: (settings: Partial<RoomSettings>) => Promise<void>;
  onJoinRoomById: (roomId: string) => Promise<void>;
  onJoinRoomByCode: (code: string) => Promise<void>;
  onSpectateRoom: (target: { roomId?: string; code?: string }) => Promise<void>;
}

type HubTab = 'FIND' | 'CREATE' | 'CODE' | 'INVITE';

export const MultiplayerHub: React.FC<MultiplayerHubProps> = ({
  user,
  publicRooms,
  initialJoinCode = '',
  errorMsg,
  onBack,
  onRefreshRooms,
  onCreateRoom,
  onJoinRoomById,
  onJoinRoomByCode,
  onSpectateRoom,
}) => {
  const [tab, setTab] = useState<HubTab>(initialJoinCode ? 'CODE' : 'FIND');
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  // Create room form state
  const [roomName, setRoomName] = useState(`${user?.nickname ?? '개척자'}의 선술집`);
  const [isPublic, setIsPublic] = useState(true);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [allowAI, setAllowAI] = useState(true);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('normal');
  const [boardMode, setBoardMode] = useState<BoardMode>('random');
  const [victoryPointsTarget, setVictoryPointsTarget] = useState(10);
  const [restrictJoinDuringGame, setRestrictJoinDuringGame] = useState(true);
  const [allowSpectators, setAllowSpectators] = useState(true);

  const filteredRooms = publicRooms.filter(
    (r) =>
      r.roomName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.hostName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateSubmit = async (e: React.FormEvent, forcePrivate?: boolean) => {
    e.preventDefault();
    await onCreateRoom({
      roomName,
      isPublic: forcePrivate !== undefined ? !forcePrivate : isPublic,
      maxPlayers,
      allowAI,
      aiDifficulty,
      boardMode,
      victoryPointsTarget,
      restrictJoinDuringGame,
      allowSpectators,
    });
  };

  const handleCopyAppInvite = () => {
    const url = window.location.origin;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedNotice('초대 기본 URL이 복사되었습니다. 비공개 방을 만들면 전용 6자리 초대 링크가 생성됩니다.');
    setTimeout(() => setCopiedNotice(null), 3000);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-5xl flex flex-col gap-5">
        {/* Top bar */}
        <header className="pixel-panel px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="pixel-btn px-3 py-2 bg-[#36251c] text-[#f5ead8] text-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" />
              메인으로
            </button>
            <h1 className="text-xl font-bold text-[#fef3c7] whitespace-nowrap">온라인 멀티플레이</h1>
          </div>
          <div className="text-xs text-[#d6c3a5] whitespace-nowrap">
            접속자: <strong className="text-[#eab308]">{user?.nickname ?? '미인증'}</strong>
          </div>
        </header>

        {/* 4 Sub-menu Navigation Tabs (Requirement 21-2) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="tablist" aria-label="멀티플레이 메뉴">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'FIND'}
            onClick={() => {
              setTab('FIND');
              onRefreshRooms();
            }}
            className={`pixel-btn py-3 px-4 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              tab === 'FIND' ? 'bg-[#1d4ed8] text-white' : 'bg-[#231710] text-[#d6c3a5]'
            }`}
          >
            <Search className="w-4 h-4" /> 공개 게임 찾기
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'CREATE'}
            onClick={() => {
              setIsPublic(false);
              setTab('CREATE');
            }}
            className={`pixel-btn py-3 px-4 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              tab === 'CREATE' ? 'bg-[#b45309] text-white' : 'bg-[#231710] text-[#d6c3a5]'
            }`}
          >
            <Plus className="w-4 h-4" /> 방 만들기 (공개/비공개)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'CODE'}
            onClick={() => setTab('CODE')}
            className={`pixel-btn py-3 px-4 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              tab === 'CODE' ? 'bg-[#15803d] text-white' : 'bg-[#231710] text-[#d6c3a5]'
            }`}
          >
            <Lock className="w-4 h-4" /> 방 코드로 참가하기
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'INVITE'}
            onClick={() => setTab('INVITE')}
            className={`pixel-btn py-3 px-4 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              tab === 'INVITE' ? 'bg-[#6d28d9] text-white' : 'bg-[#231710] text-[#d6c3a5]'
            }`}
          >
            <Users className="w-4 h-4" /> 친구 초대하기
          </button>
        </div>

        {errorMsg && (
          <div role="alert" className="pixel-panel-dark border-[#991b1b] bg-[#450a0a] px-4 py-3 text-sm text-[#fca5a5]">
            {errorMsg}
          </div>
        )}

        {/* Tab Content */}
        {tab === 'FIND' && (
          <section className="pixel-panel p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="방 이름, 방장 닉네임, 코드 검색..."
                  className="pixel-input px-3 py-2 text-sm w-full max-w-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefreshRooms}
                  className="pixel-btn px-3 py-2 bg-[#36251c] text-[#f5ead8] text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 새로고침
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPublic(true);
                    setTab('CREATE');
                  }}
                  className="pixel-btn px-4 py-2 bg-[#b45309] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  + 공개 방 만들기
                </button>
              </div>
            </div>

            {filteredRooms.length === 0 ? (
              <div className="pixel-panel-dark p-10 text-center flex flex-col items-center gap-3">
                <p className="text-sm text-[#b8a38d]">현재 참가 가능한 공개 게임방이 없습니다.</p>
                <button
                  type="button"
                  onClick={() => {
                    setIsPublic(true);
                    setTab('CREATE');
                  }}
                  className="pixel-btn px-4 py-2 bg-[#15803d] text-white text-sm font-bold cursor-pointer"
                >
                  첫 번째 공개 방 만들기
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-[#38261c] text-xs text-[#b8a38d]">
                      <th className="py-2.5 px-3">방 이름</th>
                      <th className="py-2.5 px-3">방장</th>
                      <th className="py-2.5 px-3">인원</th>
                      <th className="py-2.5 px-3">상태</th>
                      <th className="py-2.5 px-3">공개 여부</th>
                      <th className="py-2.5 px-3 text-right">입장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRooms.map((room) => (
                      <tr key={room.id} className="border-b border-[#2e1f16] hover:bg-[#19110c]">
                        <td className="py-3 px-3 font-bold text-[#fef3c7]">
                          {room.roomName}
                          <span className="ml-2 text-xs text-[#b8a38d] font-normal">
                            ({room.victoryPointsTarget}점)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#d6c3a5]">{room.hostName}</td>
                        <td className="py-3 px-3 tabular-nums text-[#f5ead8]">
                          {room.playerCount} / {room.maxPlayers}
                        </td>
                        <td className="py-3 px-3">
                          {room.status === 'waiting' ? (
                            <span className="text-[#4ade80] text-xs font-bold">대기 중</span>
                          ) : (
                            <span className="text-[#facc15] text-xs font-bold">진행 중</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-xs text-[#b8a38d]">
                          {room.isPublic ? '공개' : '비공개'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {room.status === 'waiting' ? (
                            <button
                              type="button"
                              onClick={() => onJoinRoomById(room.id)}
                              disabled={room.playerCount >= room.maxPlayers}
                              className="pixel-btn px-3 py-1.5 bg-[#15803d] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                            >
                              {room.playerCount >= room.maxPlayers ? '만석' : '참가하기'}
                            </button>
                          ) : room.allowSpectators ? (
                            <button
                              type="button"
                              onClick={() => onSpectateRoom({ roomId: room.id })}
                              className="pixel-btn px-3 py-1.5 bg-[#312e81] text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5" /> 관전하기
                            </button>
                          ) : (
                            <span className="text-xs text-[#9c8671]">입장 불가</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'CREATE' && (
          <form onSubmit={(e) => handleCreateSubmit(e)} className="pixel-panel p-6 flex flex-col gap-5">
            <h2 className="text-lg font-bold text-[#fef3c7]">새 게임방 설정</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
                방 이름
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  maxLength={28}
                  required
                  className="pixel-input px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
                공개 설정
                <select
                  value={isPublic ? 'public' : 'private'}
                  onChange={(e) => setIsPublic(e.target.value === 'public')}
                  className="pixel-input px-3 py-2 text-sm"
                >
                  <option value="public">공개 방 (목록에 표시)</option>
                  <option value="private">비공개 방 (방 코드로만 참가)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
                최대 플레이어 수
                <select
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  className="pixel-input px-3 py-2 text-sm"
                >
                  <option value={2}>2명</option>
                  <option value={3}>3명</option>
                  <option value={4}>4명</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
                승리 목표 점수
                <select
                  value={victoryPointsTarget}
                  onChange={(e) => setVictoryPointsTarget(Number(e.target.value))}
                  className="pixel-input px-3 py-2 text-sm"
                >
                  <option value={8}>8점</option>
                  <option value={10}>10점 (표준)</option>
                  <option value={12}>12점</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
                게임판 배치 방식
                <select
                  value={boardMode}
                  onChange={(e) => setBoardMode(e.target.value as BoardMode)}
                  className="pixel-input px-3 py-2 text-sm"
                >
                  <option value="random">무작위 타일 배치</option>
                  <option value="standard">표준 고정 타일 배치</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
                AI 난이도
                <select
                  value={aiDifficulty}
                  onChange={(e) => setAiDifficulty(e.target.value as AIDifficulty)}
                  className="pixel-input px-3 py-2 text-sm"
                >
                  <option value="easy">쉬움</option>
                  <option value="normal">보통</option>
                  <option value="hard">어려움</option>
                </select>
              </label>
            </div>

            <div className="pixel-panel-dark p-4 flex flex-wrap gap-6 text-xs text-[#f5ead8]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowAI}
                  onChange={(e) => setAllowAI(e.target.checked)}
                />
                대기실에서 AI 참가 허용
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restrictJoinDuringGame}
                  onChange={(e) => setRestrictJoinDuringGame(e.target.checked)}
                />
                게임 시작 후 일반 참가 제한
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSpectators}
                  onChange={(e) => setAllowSpectators(e.target.checked)}
                />
                관전자 입장 허용
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="submit"
                className="pixel-btn px-6 py-3 bg-[#b45309] text-white font-bold text-sm cursor-pointer"
              >
                {isPublic ? '공개 방 생성하기' : '비공개 방 생성하기'}
              </button>
            </div>
          </form>
        )}

        {tab === 'CODE' && (
          <section className="pixel-panel p-6 flex flex-col gap-4 max-w-lg mx-auto w-full">
            <h2 className="text-lg font-bold text-[#fef3c7]">6자리 방 코드로 입장</h2>
            <p className="text-xs text-[#b8a38d]">
              친구에게 전달받은 6자리 방 코드를 입력하세요. 비공개 방도 코드로 바로 입장하거나 진행 중인 게임을 관전할 수 있습니다.
            </p>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="예: A3K9P2"
              className="pixel-input px-4 py-3 text-center text-2xl font-bold tracking-[0.25em] uppercase tabular-nums"
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={joinCode.trim().length < 4}
                onClick={() => onJoinRoomByCode(joinCode)}
                className="pixel-btn py-3 px-4 bg-[#15803d] text-white font-bold text-sm cursor-pointer"
              >
                플레이어로 참가
              </button>
              <button
                type="button"
                disabled={joinCode.trim().length < 4}
                onClick={() => onSpectateRoom({ code: joinCode })}
                className="pixel-btn py-3 px-4 bg-[#312e81] text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Eye className="w-4 h-4" /> 관전하기
              </button>
            </div>
          </section>
        )}

        {tab === 'INVITE' && (
          <section className="pixel-panel p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-[#fef3c7]">친구 초대하기</h2>
            <p className="text-sm text-[#d6c3a5] leading-relaxed">
              비공개 방을 즉시 생성하면 친구가 클릭 한 번으로 바로 입장할 수 있는 6자리 코드와 초대 링크가 발급됩니다.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={(e) => handleCreateSubmit(e as unknown as React.FormEvent, true)}
                className="pixel-btn px-5 py-3 bg-[#6d28d9] text-white font-bold text-sm cursor-pointer"
              >
                친구 초대용 비공개 방 바로 만들기
              </button>
              <button
                type="button"
                onClick={handleCopyAppInvite}
                className="pixel-btn px-4 py-3 bg-[#36251c] text-[#f5ead8] font-bold text-sm flex items-center gap-2 cursor-pointer"
              >
                <Copy className="w-4 h-4" /> 게임 주소 복사
              </button>
            </div>
            {copiedNotice && <p className="text-xs text-[#4ade80]">{copiedNotice}</p>}
          </section>
        )}
      </div>
    </div>
  );
};
