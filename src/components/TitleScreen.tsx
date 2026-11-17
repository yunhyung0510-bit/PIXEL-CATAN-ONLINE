import React, { useEffect, useState } from 'react';
import { UserProfile, AIDifficulty, BoardMode } from '../shared/types';
import { PixelEmblemLogo, ResourcePixelIcon } from './PixelIcons';
import { Bot, Gamepad2, Globe, History, Settings, ShieldCheck } from 'lucide-react';

interface TitleScreenProps {
  user: UserProfile | null;
  authError: string | null;
  authLoading: boolean;
  onAuthenticate: (nickname: string, pin: string) => Promise<boolean>;
  onStartSingle: () => void;
  onStartAI: (aiCount: number, difficulty: AIDifficulty, boardMode: BoardMode, targetVP: number) => void;
  onOpenMultiplayer: () => void;
  onOpenRecords: () => void;
  onOpenSettings: () => void;
  defaultDifficulty: AIDifficulty;
  defaultBoardMode: BoardMode;
  defaultVictoryPoints: number;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  user,
  authError,
  authLoading,
  onAuthenticate,
  onStartSingle,
  onStartAI,
  onOpenMultiplayer,
  onOpenRecords,
  onOpenSettings,
  defaultDifficulty,
  defaultBoardMode,
  defaultVictoryPoints,
}) => {
  const [nickname, setNickname] = useState(user?.nickname ?? '개척자');
  const [pin, setPin] = useState('1234');
  const [showAISetup, setShowAISetup] = useState(false);
  const [aiCount, setAiCount] = useState(3);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>(defaultDifficulty);
  const [boardMode, setBoardMode] = useState<BoardMode>(defaultBoardMode);
  const [targetVP, setTargetVP] = useState(defaultVictoryPoints);

  useEffect(() => {
    if (user?.nickname) {
      setNickname(user.nickname);
    }
  }, [user]);

  // Keyboard Enter/Space to start when not typing in an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onStartSingle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStartSingle]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onAuthenticate(nickname, pin);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
      {/* Subtle decorative tavern board tiles in background corners */}
      <div className="pointer-events-none fixed inset-0 opacity-15 flex items-center justify-center">
        <div className="w-[680px] h-[680px] border-4 border-[#5c3f2e] rotate-45" />
      </div>

      <main className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Hero / Emblem & Menu */}
        <section className="lg:col-span-7 pixel-panel p-6 md:p-8 flex flex-col justify-between gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <PixelEmblemLogo />
              <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#fef3c7] text-balance">
                  픽셀 카탄 온라인
                </h1>
                <p className="text-sm text-[#b8a38d] mt-1">
                  어두운 선술집 테이블 위의 16비트 전략 개척 보드게임
                </p>
              </div>
            </div>

            {/* Resource showcase strip */}
            <div className="flex items-center gap-4 py-2 px-3 pixel-panel-dark text-xs text-[#d6c3a5]">
              <span className="flex items-center gap-1.5">
                <ResourcePixelIcon type="wood" size={16} /> 나무
              </span>
              <span className="flex items-center gap-1.5">
                <ResourcePixelIcon type="brick" size={16} /> 벽돌
              </span>
              <span className="flex items-center gap-1.5">
                <ResourcePixelIcon type="sheep" size={16} /> 양
              </span>
              <span className="flex items-center gap-1.5">
                <ResourcePixelIcon type="wheat" size={16} /> 밀
              </span>
              <span className="flex items-center gap-1.5">
                <ResourcePixelIcon type="ore" size={16} /> 철광석
              </span>
            </div>
          </div>

          {/* 5 Main Menu Actions */}
          <nav aria-label="메인 메뉴" className="flex flex-col gap-3">
            <button
              type="button"
              data-start="true"
              onClick={onStartSingle}
              className="pixel-btn w-full py-3.5 px-5 bg-[#b45309] text-[#fef3c7] font-bold text-base flex items-center justify-between cursor-pointer whitespace-nowrap"
            >
              <span className="flex items-center gap-3">
                <Gamepad2 className="w-5 h-5" />
                1. 싱글 플레이
              </span>
              <span className="text-xs text-[#fde68a]">즉시 시작</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAISetup((prev) => !prev)}
              className="pixel-btn w-full py-3 px-5 bg-[#36251c] text-[#f5ead8] font-bold text-base flex items-center justify-between cursor-pointer whitespace-nowrap"
            >
              <span className="flex items-center gap-3">
                <Bot className="w-5 h-5 text-[#60a5fa]" />
                2. AI 대전
              </span>
              <span className="text-xs text-[#b8a38d]">난이도 및 인원 설정</span>
            </button>

            {showAISetup && (
              <div className="pixel-panel-dark p-4 flex flex-col gap-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs text-[#d6c3a5]">
                    AI 수
                    <select
                      value={aiCount}
                      onChange={(e) => setAiCount(Number(e.target.value))}
                      className="pixel-input px-2.5 py-2 text-sm"
                    >
                      <option value={1}>1명 (1 vs 1)</option>
                      <option value={2}>2명 (3인전)</option>
                      <option value={3}>3명 (4인전)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[#d6c3a5]">
                    AI 난이도
                    <select
                      value={aiDifficulty}
                      onChange={(e) => setAiDifficulty(e.target.value as AIDifficulty)}
                      className="pixel-input px-2.5 py-2 text-sm"
                    >
                      <option value="easy">쉬움</option>
                      <option value="normal">보통</option>
                      <option value="hard">어려움</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[#d6c3a5]">
                    게임판
                    <select
                      value={boardMode}
                      onChange={(e) => setBoardMode(e.target.value as BoardMode)}
                      className="pixel-input px-2.5 py-2 text-sm"
                    >
                      <option value="random">무작위 타일</option>
                      <option value="standard">표준 배치</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[#d6c3a5]">
                    승리 점수
                    <select
                      value={targetVP}
                      onChange={(e) => setTargetVP(Number(e.target.value))}
                      className="pixel-input px-2.5 py-2 text-sm"
                    >
                      <option value={8}>8점 (빠른 게임)</option>
                      <option value={10}>10점 (표준)</option>
                      <option value={12}>12점 (장기전)</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => onStartAI(aiCount, aiDifficulty, boardMode, targetVP)}
                  className="pixel-btn py-2.5 px-4 bg-[#15803d] text-white font-bold text-sm cursor-pointer"
                >
                  AI 대전 시작하기
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenMultiplayer}
              className="pixel-btn w-full py-3.5 px-5 bg-[#1d4ed8] text-white font-bold text-base flex items-center justify-between cursor-pointer whitespace-nowrap"
            >
              <span className="flex items-center gap-3">
                <Globe className="w-5 h-5" />
                3. 온라인 멀티플레이
              </span>
              <span className="text-xs text-[#bfdbfe]">방 찾기 · 만들기 · 관전</span>
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onOpenRecords}
                className="pixel-btn py-3 px-4 bg-[#2e1f16] text-[#f5ead8] font-bold text-sm flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <History className="w-4 h-4 text-[#eab308]" />
                4. 게임 기록
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="pixel-btn py-3 px-4 bg-[#2e1f16] text-[#f5ead8] font-bold text-sm flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Settings className="w-4 h-4 text-[#b8a38d]" />
                5. 설정
              </button>
            </div>
          </nav>

          <p className="text-xs text-[#9c8671]">
            Enter / Space 키로 싱글 플레이 즉시 시작 · 승점 10점 선취 시 승리
          </p>
        </section>

        {/* Right Panel: Nickname + 4-digit PIN Auth & Quick Rules */}
        <aside className="lg:col-span-5 flex flex-col gap-5">
          <div className="pixel-panel p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#fef3c7]">플레이어 프로필 (PIN 인증)</h2>
              {user && (
                <span className="flex items-center gap-1 text-xs text-[#4ade80] font-bold">
                  <ShieldCheck className="w-4 h-4" /> 인증됨
                </span>
              )}
            </div>
            <p className="text-xs text-[#b8a38d] leading-relaxed">
              닉네임과 숫자 4자리 PIN으로 계정을 보호합니다. 연결이 끊어졌을 때 동일한 닉네임과 PIN으로만 기존 자리에 재접속할 수 있습니다.
            </p>

            <form onSubmit={handleLoginSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-[#d6c3a5]">
                닉네임 (2~14자)
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={14}
                  required
                  placeholder="예: 개척자"
                  className="pixel-input px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-[#d6c3a5]">
                4자리 PIN 비밀번호
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  required
                  placeholder="숫자 4자리"
                  className="pixel-input px-3 py-2 text-sm tracking-widest tabular-nums"
                />
              </label>

              {authError && (
                <p role="alert" className="text-xs text-[#f87171] bg-[#450a0a] p-2 border border-[#991b1b]">
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="pixel-btn py-2.5 px-4 bg-[#4f3628] text-[#fef3c7] font-bold text-sm cursor-pointer"
              >
                {authLoading ? '인증 중...' : user ? '프로필 변경 / 재인증' : '닉네임 · PIN 로그인'}
              </button>
            </form>
          </div>

          <div className="pixel-panel p-5 flex-1 flex flex-col gap-2.5 text-xs text-[#d6c3a5] leading-relaxed">
            <h3 className="text-sm font-bold text-[#eab308]">건설 비용 & 승리 조건</h3>
            <div className="grid grid-cols-1 gap-1.5 tabular-nums">
              <div>• 도로 (0점): 나무 1 + 벽돌 1</div>
              <div>• 마을 (1점): 나무 1 + 벽돌 1 + 양 1 + 밀 1</div>
              <div>• 도시 (2점): 밀 2 + 철광석 3 (마을 업그레이드)</div>
              <div>• 발전 카드: 양 1 + 밀 1 + 철광석 1</div>
              <div>• 최장 교역로 (5+ 연결): +2점 · 최강 기사단 (3+ 회): +2점</div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};
