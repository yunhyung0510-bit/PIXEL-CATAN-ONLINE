import React from 'react';
import { AIDifficulty, BoardMode, GameRecord, PLAYER_COLOR_HEX } from '../shared/types';
import { ClientSettings } from '../types/client';
import { ArrowLeft, Trophy, Volume2, VolumeX } from 'lucide-react';

export const RecordsView: React.FC<{
  records: GameRecord[];
  onRefresh: () => void;
  onBack: () => void;
}> = ({ records, onRefresh, onBack }) => {
  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-5xl flex flex-col gap-5">
        <header className="pixel-panel px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="pixel-btn px-3 py-2 bg-[#36251c] text-[#f5ead8] text-sm flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> 메인으로
            </button>
            <h1 className="text-xl font-bold text-[#fef3c7]">게임 기록</h1>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="pixel-btn px-3 py-2 bg-[#4f3628] text-[#fef3c7] text-xs font-bold cursor-pointer"
          >
            새로고침
          </button>
        </header>

        <section className="pixel-panel p-5">
          {records.length === 0 ? (
            <div className="pixel-panel-dark p-10 text-center text-sm text-[#b8a38d]">
              아직 완료된 게임 기록이 없습니다. 싱글 플레이, AI 대전 또는 온라인 멀티플레이에서 첫 승리를 달성해 보세요!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[#38261c] text-xs text-[#b8a38d]">
                    <th className="py-2.5 px-3">방 이름</th>
                    <th className="py-2.5 px-3">모드</th>
                    <th className="py-2.5 px-3">우승자</th>
                    <th className="py-2.5 px-3">참가자 및 최종 승점</th>
                    <th className="py-2.5 px-3 text-right">진행 턴</th>
                    <th className="py-2.5 px-3 text-right">종료 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr key={rec.id} className="border-b border-[#2e1f16] hover:bg-[#19110c]">
                      <td className="py-3 px-3 font-bold text-[#fef3c7]">{rec.roomName}</td>
                      <td className="py-3 px-3 text-xs text-[#d6c3a5]">
                        {rec.mode === 'single' ? '싱글' : rec.mode === 'ai' ? 'AI 대전' : '온라인'}
                      </td>
                      <td className="py-3 px-3 font-bold text-[#eab308]">
                        <span className="inline-flex items-center gap-1">
                          <Trophy className="w-3.5 h-3.5" /> {rec.winnerNickname}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                          {rec.players.map((p) => (
                            <span key={p.playerId} className="inline-flex items-center gap-1 text-[#f5ead8]">
                              <span
                                className="w-2.5 h-2.5 inline-block border border-black"
                                style={{ backgroundColor: PLAYER_COLOR_HEX[p.color].primary }}
                              />
                              {p.rank}위 {p.nickname}: {p.finalVP}점
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-[#d6c3a5]">
                        {rec.turnCount}턴
                      </td>
                      <td className="py-3 px-3 text-right text-xs text-[#b8a38d] tabular-nums">
                        {new Date(rec.endedAt).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export const SettingsView: React.FC<{
  settings: ClientSettings;
  onChange: (next: ClientSettings) => void;
  onBack: () => void;
}> = ({ settings, onChange, onBack }) => {
  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 md:p-8">
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <header className="pixel-panel px-5 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="pixel-btn px-3 py-2 bg-[#36251c] text-[#f5ead8] text-sm flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> 메인으로
          </button>
          <h1 className="text-xl font-bold text-[#fef3c7]">게임 설정</h1>
        </header>

        <section className="pixel-panel p-6 flex flex-col gap-5 text-sm">
          <div className="flex items-center justify-between pixel-panel-dark p-4">
            <div>
              <div className="font-bold text-[#fef3c7]">8비트 효과음 (SFX)</div>
              <div className="text-xs text-[#b8a38d] mt-0.5">
                주사위 굴림, 건설, 교역, 도둑 알림 효과음 재생
              </div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...settings, soundEnabled: !settings.soundEnabled })}
              className={`pixel-btn px-4 py-2 text-xs font-bold flex items-center gap-2 cursor-pointer ${
                settings.soundEnabled ? 'bg-[#15803d] text-white' : 'bg-[#36251c] text-[#b8a38d]'
              }`}
            >
              {settings.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              {settings.soundEnabled ? '켜짐' : '꺼짐'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
              기본 AI 난이도
              <select
                value={settings.defaultDifficulty}
                onChange={(e) =>
                  onChange({ ...settings, defaultDifficulty: e.target.value as AIDifficulty })
                }
                className="pixel-input px-3 py-2 text-sm"
              >
                <option value="easy">쉬움</option>
                <option value="normal">보통</option>
                <option value="hard">어려움</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
              기본 게임판 배치
              <select
                value={settings.defaultBoardMode}
                onChange={(e) =>
                  onChange({ ...settings, defaultBoardMode: e.target.value as BoardMode })
                }
                className="pixel-input px-3 py-2 text-sm"
              >
                <option value="random">무작위 타일</option>
                <option value="standard">표준 배치</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-xs text-[#d6c3a5]">
              기본 승리 목표 점수
              <select
                value={settings.defaultVictoryPoints}
                onChange={(e) =>
                  onChange({ ...settings, defaultVictoryPoints: Number(e.target.value) })
                }
                className="pixel-input px-3 py-2 text-sm"
              >
                <option value={8}>8점</option>
                <option value={10}>10점 (표준)</option>
                <option value={12}>12점</option>
              </select>
            </label>

            <div className="flex items-center justify-between pixel-panel-dark p-3">
              <span className="text-xs text-[#d6c3a5]">건설 도움말 힌트 표시</span>
              <input
                type="checkbox"
                checked={settings.showBuildHints}
                onChange={(e) => onChange({ ...settings, showBuildHints: e.target.checked })}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
