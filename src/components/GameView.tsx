import React, { useMemo, useState } from 'react';
import {
  ChatMessage,
  ClientGameState,
  createEmptyResources,
  DEV_CARD_LABELS_KO,
  DevCardType,
  GameActionPayload,
  GameRoom,
  PLAYER_COLOR_HEX,
  RESOURCE_LABELS_KO,
  RESOURCE_TYPES,
  ResourceMap,
  ResourceType,
} from '../shared/types';
import {
  getPlayerBestTradeRatio,
  getTotalResourceCount,
} from '../shared/catan';
import { BuildInteractionMode } from '../types/client';
import { HexBoard } from './HexBoard';
import { PixelDiceFace, ResourcePixelIcon } from './PixelIcons';
import {
  ArrowLeftRight,
  Bot,
  Crown,
  Dices,
  Eye,
  Flag,
  Hammer,
  Home,
  LogOut,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';

interface GameViewProps {
  room: GameRoom;
  state: ClientGameState;
  chatMessages: ChatMessage[];
  socketConnected: boolean;
  muted: boolean;
  actionError: string | null;
  onToggleMute: () => void;
  onDispatchAction: (action: GameActionPayload) => Promise<void>;
  onSendChat: (text: string) => void;
  onReconnect: () => void;
  onReplaceDisconnectedWithAI: (playerId: string) => void;
  onLeaveGame: () => void;
  onPlayAgain?: () => void;
}

function makeReqId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const PHASE_LABELS_KO: Record<ClientGameState['phase'], string> = {
  SETUP_SETTLEMENT: '초기 마을 건설',
  SETUP_ROAD: '초기 도로 건설',
  ROLL: '주사위 굴리기',
  DISCARD: '7장 초과 자원 버리기',
  ROBBER_MOVE: '도둑 이동',
  ROBBER_STEAL: '자원 약탈 선택',
  MAIN: '교역 및 건설',
  GAME_OVER: '게임 종료',
};

export const GameView: React.FC<GameViewProps> = ({
  room,
  state,
  chatMessages,
  socketConnected,
  muted,
  actionError,
  onToggleMute,
  onDispatchAction,
  onSendChat,
  onReconnect,
  onReplaceDisconnectedWithAI,
  onLeaveGame,
  onPlayAgain,
}) => {
  const [interactionMode, setInteractionMode] = useState<BuildInteractionMode>('NONE');
  const [rightTab, setRightTab] = useState<'ALL' | 'CHAT' | 'LOG'>('ALL');
  const [chatInput, setChatInput] = useState('');
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeTab, setTradeTab] = useState<'PLAYER' | 'BANK'>('BANK');
  const [showDevModal, setShowDevModal] = useState(false);

  // Bank trade state
  const [bankGive, setBankGive] = useState<ResourceType>('wood');
  const [bankWant, setBankWant] = useState<ResourceType>('brick');

  // Player trade offer state
  const [offerGive, setOfferGive] = useState<ResourceMap>(createEmptyResources());
  const [offerWant, setOfferWant] = useState<ResourceMap>(createEmptyResources());

  // Discard modal state
  const [discardMap, setDiscardMap] = useState<ResourceMap>(createEmptyResources());

  // Year of Plenty / Monopoly pick modal
  const [devPickCard, setDevPickCard] = useState<'yearOfPlenty' | 'monopoly' | null>(null);
  const [yopPicks, setYopPicks] = useState<[ResourceType, ResourceType]>(['wood', 'brick']);
  const [monoPick, setMonoPick] = useState<ResourceType>('wheat');

  const currentPlayer = state.players[state.currentPlayerIndex];
  const me = state.players.find((p) => p.id === state.viewerId);
  const isMyTurn = !state.isSpectator && currentPlayer?.id === state.viewerId;
  const isHost = room.hostId === state.viewerId;
  const mustDiscard = !state.isSpectator && state.phase === 'DISCARD' && state.pendingDiscardPlayerIds.includes(state.viewerId);
  const myResources = me?.resources ?? createEmptyResources();

  const canAfford = useMemo(() => {
    return {
      road: state.freeRoadsRemaining > 0 || (myResources.wood >= 1 && myResources.brick >= 1),
      settlement:
        myResources.wood >= 1 &&
        myResources.brick >= 1 &&
        myResources.sheep >= 1 &&
        myResources.wheat >= 1,
      city: myResources.wheat >= 2 && myResources.ore >= 3,
      dev: myResources.sheep >= 1 && myResources.wheat >= 1 && myResources.ore >= 1,
    };
  }, [myResources, state.freeRoadsRemaining]);

  const handleSelectVertex = async (vertexId: string) => {
    if (!isMyTurn) return;
    if (state.phase === 'SETUP_SETTLEMENT') {
      await onDispatchAction({
        type: 'PLACE_SETUP_SETTLEMENT',
        vertexId,
        requestId: makeReqId(),
      });
    } else if (state.phase === 'MAIN' && interactionMode === 'BUILD_SETTLEMENT') {
      await onDispatchAction({
        type: 'BUILD_SETTLEMENT',
        vertexId,
        requestId: makeReqId(),
      });
      setInteractionMode('NONE');
    } else if (state.phase === 'MAIN' && interactionMode === 'UPGRADE_CITY') {
      await onDispatchAction({
        type: 'UPGRADE_CITY',
        vertexId,
        requestId: makeReqId(),
      });
      setInteractionMode('NONE');
    }
  };

  const handleSelectEdge = async (edgeId: string) => {
    if (!isMyTurn) return;
    if (state.phase === 'SETUP_ROAD') {
      await onDispatchAction({
        type: 'PLACE_SETUP_ROAD',
        edgeId,
        requestId: makeReqId(),
      });
    } else if (
      state.phase === 'MAIN' &&
      (interactionMode === 'BUILD_ROAD' || state.freeRoadsRemaining > 0)
    ) {
      await onDispatchAction({
        type: 'BUILD_ROAD',
        edgeId,
        requestId: makeReqId(),
      });
      if (state.freeRoadsRemaining <= 1) {
        setInteractionMode('NONE');
      }
    }
  };

  const handleSelectHex = async (hexId: number) => {
    if (!isMyTurn) return;
    if (state.phase === 'ROBBER_MOVE') {
      await onDispatchAction({
        type: 'MOVE_ROBBER',
        hexId,
        requestId: makeReqId(),
      });
      setInteractionMode('NONE');
    }
  };

  const handleBankTrade = async () => {
    if (bankGive === bankWant) return;
    const ratio = getPlayerBestTradeRatio(state as never, state.viewerId, bankGive);
    await onDispatchAction({
      type: 'BANK_TRADE',
      give: bankGive,
      giveAmount: ratio,
      want: bankWant,
      requestId: makeReqId(),
    });
  };

  const handleProposePlayerTrade = async () => {
    await onDispatchAction({
      type: 'OFFER_TRADE',
      give: offerGive,
      want: offerWant,
      requestId: makeReqId(),
    });
    setOfferGive(createEmptyResources());
    setOfferWant(createEmptyResources());
    setShowTradeModal(false);
  };

  const requiredDiscardCount = Math.floor(getTotalResourceCount(myResources) / 2);
  const selectedDiscardCount = getTotalResourceCount(discardMap);

  const handleSubmitDiscard = async () => {
    await onDispatchAction({
      type: 'DISCARD_RESOURCES',
      resources: discardMap,
      requestId: makeReqId(),
    });
    setDiscardMap(createEmptyResources());
  };

  const handlePlayDevCard = async (card: DevCardType) => {
    if (card === 'victoryPoint') return;
    if (card === 'yearOfPlenty' || card === 'monopoly') {
      setDevPickCard(card);
      setShowDevModal(false);
      return;
    }
    await onDispatchAction({
      type: 'PLAY_DEV_CARD',
      card,
      requestId: makeReqId(),
    });
    setShowDevModal(false);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  const myPlayableDevCounts = useMemo(() => {
    const counts: Record<DevCardType, number> = {
      knight: 0,
      roadBuilding: 0,
      yearOfPlenty: 0,
      monopoly: 0,
      victoryPoint: 0,
    };
    (me?.devCards ?? []).forEach((c) => {
      counts[c] += 1;
    });
    return counts;
  }, [me?.devCards]);

  const effectiveRatio = getPlayerBestTradeRatio(state as never, state.viewerId, bankGive);

  // Determine prompt guidance banner
  let promptBanner = `${currentPlayer?.nickname ?? ''}님의 차례 · ${PHASE_LABELS_KO[state.phase]}`;
  if (state.isSpectator) {
    promptBanner = `관전 모드 · ${currentPlayer?.nickname ?? ''}님의 차례 (${PHASE_LABELS_KO[state.phase]})`;
  } else if (mustDiscard) {
    promptBanner = `7이 나왔습니다! 자원 ${requiredDiscardCount}장을 선택해 버려주세요.`;
  } else if (isMyTurn) {
    if (state.phase === 'SETUP_SETTLEMENT') promptBanner = '내 차례: 보드의 노란 사각형을 눌러 초기 마을을 건설하세요.';
    else if (state.phase === 'SETUP_ROAD') promptBanner = '내 차례: 마을과 이어진 노란 선을 눌러 초기 도로를 건설하세요.';
    else if (state.phase === 'ROLL') promptBanner = '내 차례: 주사위를 굴려 자원을 생산하세요.';
    else if (state.phase === 'ROBBER_MOVE') promptBanner = '내 차례: 도둑을 이동시킬 다른 타일을 클릭하세요.';
    else if (state.phase === 'ROBBER_STEAL') promptBanner = '내 차례: 자원을 1장 약탈할 상대를 선택하세요.';
    else if (state.freeRoadsRemaining > 0) promptBanner = `도로 건설 카드 발동! 무료 도로 ${state.freeRoadsRemaining}개를 배치하세요.`;
    else if (interactionMode !== 'NONE') promptBanner = '보드에서 건설할 위치를 선택하세요. (취소하려면 버튼 재클릭)';
    else promptBanner = '내 차례: 교역, 건설, 발전 카드 사용 후 턴을 종료하세요.';
  }

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#150e0a]">
      {/* Top Bar: Room Info, Turn Status, Utility Buttons */}
      <header className="px-3 py-2 bg-[#1d130d] border-b-3 border-[#0b0705] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold text-sm text-[#fef3c7] whitespace-nowrap">
            {room.settings.roomName}
          </span>
          <span className="text-xs text-[#b8a38d] whitespace-nowrap hidden sm:inline">
            코드 {room.code} · 목표 {state.victoryPointsTarget}점 · 턴{' '}
            <span className="tabular-nums">{state.turnNumber}</span>
          </span>
          {state.isSpectator && (
            <span className="px-2 py-0.5 bg-[#312e81] border border-[#6366f1] text-xs font-bold text-[#e0e7ff] inline-flex items-center gap-1 whitespace-nowrap">
              <Eye className="w-3.5 h-3.5" /> 관전 중
            </span>
          )}
        </div>

        <div
          className={`px-3 py-1 text-xs font-bold border-2 truncate ${
            isMyTurn
              ? 'bg-[#052e16] border-[#22c55e] text-[#86efac]'
              : 'bg-[#231710] border-[#4f3628] text-[#fde68a]'
          }`}
          data-testid="turn-banner"
        >
          {promptBanner}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? '효과음 켜기' : '효과음 끄기'}
            className="pixel-btn p-1.5 bg-[#36251c] text-[#f5ead8] cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onLeaveGame}
            className="pixel-btn px-3 py-1.5 bg-[#7f1d1d] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" /> 나가기
          </button>
        </div>
      </header>

      {/* Connection Lost Banner (Requirement 21-10) */}
      {!socketConnected && (
        <div className="bg-[#7f1d1d] border-b-2 border-[#ef4444] px-4 py-2 flex items-center justify-between text-xs text-white shrink-0">
          <span className="flex items-center gap-2 font-bold">
            <WifiOff className="w-4 h-4" /> 서버와의 연결이 끊어졌습니다. 기존 자원과 턴은 서버에 보존됩니다.
          </span>
          <button
            type="button"
            onClick={onReconnect}
            className="pixel-btn px-3 py-1 bg-[#eab308] text-[#1a120e] font-bold flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 재접속
          </button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="bg-[#450a0a] border-b-2 border-[#dc2626] px-4 py-1.5 text-xs text-[#fca5a5] text-center shrink-0">
          {actionError}
        </div>
      )}

      {/* Main Content Grid: Left Players + Center Board + Right Chat/Log */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2 p-2">
        {/* Left Player Scoreboard Strip */}
        <aside className="lg:col-span-2 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto pixel-scroll shrink-0">
          {state.players.map((p, idx) => {
            const palette = PLAYER_COLOR_HEX[p.color];
            const isActive = idx === state.currentPlayerIndex;
            const isSelf = !state.isSpectator && p.id === state.viewerId;
            return (
              <div
                key={p.id}
                className={`pixel-panel p-2.5 flex flex-col gap-1.5 min-w-[165px] lg:min-w-0 ${
                  isActive ? 'ring-2 ring-[#eab308]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-3.5 h-3.5 border border-black shrink-0"
                      style={{ backgroundColor: palette.primary }}
                    />
                    <span className="font-bold text-xs text-[#fef3c7] truncate">
                      {p.nickname}
                      {isSelf ? ' (나)' : ''}
                    </span>
                    {p.isAI && <Bot className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />}
                  </div>
                  <span
                    className="font-bold text-sm text-[#eab308] tabular-nums shrink-0"
                    data-testid={`player-vp-${p.id}`}
                  >
                    {p.totalVP !== undefined ? `${p.totalVP}점` : `${p.publicVP}점`}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#d6c3a5] tabular-nums">
                  <span>자원 {p.resourceCount}장</span>
                  <span>발전 {p.devCardCount}장</span>
                  <span>기사 {p.playedKnights}회</span>
                </div>

                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {p.hasLongestRoad && (
                    <span className="px-1.5 py-0.5 bg-[#422006] border border-[#eab308] text-[#fde047] font-bold">
                      최장도로({p.longestRoadLength}) +2
                    </span>
                  )}
                  {p.hasLargestArmy && (
                    <span className="px-1.5 py-0.5 bg-[#450a0a] border border-[#ef4444] text-[#fca5a5] font-bold">
                      최강기사({p.playedKnights}) +2
                    </span>
                  )}
                  {!p.connected && !p.isAI && (
                    <div className="w-full flex items-center justify-between gap-1 mt-1 bg-[#450a0a] px-1.5 py-1 border border-[#991b1b]">
                      <span className="text-[#fca5a5] font-bold">연결 끊김</span>
                      {isHost && (
                        <button
                          type="button"
                          onClick={() => onReplaceDisconnectedWithAI(p.id)}
                          className="px-1.5 py-0.5 bg-[#1d4ed8] text-white text-[10px] font-bold cursor-pointer"
                        >
                          AI 대체
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Dice Display Card */}
          <div className="pixel-panel-dark p-3 flex flex-col items-center justify-center gap-2 min-w-[130px] lg:min-w-0">
            <div className="text-[11px] text-[#b8a38d]">최근 주사위</div>
            {state.dice ? (
              <div className="flex items-center gap-2">
                <PixelDiceFace value={state.dice[0]} size={32} />
                <PixelDiceFace value={state.dice[1]} size={32} />
                <span className="text-lg font-bold text-[#eab308] tabular-nums ml-1">
                  {state.dice[0] + state.dice[1]}
                </span>
              </div>
            ) : (
              <div className="text-xs text-[#9c8671]">대기 중</div>
            )}
          </div>
        </aside>

        {/* Center: 19-Hex Pixel Catan Board + Active Trade Offers */}
        <main className="lg:col-span-7 relative flex flex-col items-center justify-center min-h-0 pixel-panel-dark p-2">
          <HexBoard
            state={state}
            interactionMode={interactionMode}
            onSelectHex={handleSelectHex}
            onSelectVertex={handleSelectVertex}
            onSelectEdge={handleSelectEdge}
          />

          {/* Live Online Trade Offer Banner (Requirement 21-8) */}
          {state.activeTradeOffers.length > 0 && (
            <div className="absolute top-2 left-2 right-2 flex flex-col gap-2 pointer-events-none">
              {state.activeTradeOffers.map((offer) => {
                const proposer = state.players.find((p) => p.id === offer.fromPlayerId);
                const isMine = offer.fromPlayerId === state.viewerId;
                const alreadyRejected = offer.rejectedBy.includes(state.viewerId);
                const canRespond =
                  !state.isSpectator &&
                  !isMine &&
                  !alreadyRejected &&
                  (!offer.targetPlayerId || offer.targetPlayerId === state.viewerId);
                const canAffordOffer = RESOURCE_TYPES.every(
                  (r) => myResources[r] >= offer.want[r]
                );

                return (
                  <div
                    key={offer.id}
                    className="pointer-events-auto pixel-panel px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[#eab308]">{proposer?.nickname} 거래 제안:</strong>
                      <span className="text-[#86efac]">
                        드림{' '}
                        {RESOURCE_TYPES.filter((r) => offer.give[r] > 0)
                          .map((r) => `${RESOURCE_LABELS_KO[r]} ${offer.give[r]}`)
                          .join(', ')}
                      </span>
                      <span>↔</span>
                      <span className="text-[#fca5a5]">
                        요청{' '}
                        {RESOURCE_TYPES.filter((r) => offer.want[r] > 0)
                          .map((r) => `${RESOURCE_LABELS_KO[r]} ${offer.want[r]}`)
                          .join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isMine && (
                        <button
                          type="button"
                          onClick={() =>
                            onDispatchAction({
                              type: 'CANCEL_TRADE',
                              offerId: offer.id,
                              requestId: makeReqId(),
                            })
                          }
                          className="pixel-btn px-2.5 py-1 bg-[#7f1d1d] text-white font-bold cursor-pointer"
                        >
                          제안 취소
                        </button>
                      )}
                      {canRespond && (
                        <>
                          <button
                            type="button"
                            disabled={!canAffordOffer}
                            onClick={() =>
                              onDispatchAction({
                                type: 'ACCEPT_TRADE',
                                offerId: offer.id,
                                requestId: makeReqId(),
                              })
                            }
                            className="pixel-btn px-2.5 py-1 bg-[#15803d] text-white font-bold cursor-pointer"
                          >
                            수락
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onDispatchAction({
                                type: 'REJECT_TRADE',
                                offerId: offer.id,
                                requestId: makeReqId(),
                              })
                            }
                            className="pixel-btn px-2.5 py-1 bg-[#36251c] text-[#f5ead8] font-bold cursor-pointer"
                          >
                            거절
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* Right Non-overlapping Chat & Game Log Panel (Requirement 21-12) */}
        <aside className="lg:col-span-3 pixel-panel p-3 flex flex-col min-h-0">
          <div className="flex items-center gap-1 mb-2 shrink-0">
            {(['ALL', 'CHAT', 'LOG'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRightTab(t)}
                className={`pixel-btn flex-1 py-1.5 text-xs font-bold cursor-pointer ${
                  rightTab === t ? 'bg-[#b45309] text-white' : 'bg-[#19110c] text-[#b8a38d]'
                }`}
              >
                {t === 'ALL' ? '전체' : t === 'CHAT' ? '채팅' : '게임 로그'}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 pixel-panel-dark p-2.5 overflow-y-auto pixel-scroll flex flex-col gap-1.5 text-xs">
            {rightTab !== 'LOG' &&
              chatMessages.map((m) => (
                <div key={m.id} className="leading-snug">
                  {m.category === 'chat' ? (
                    <span>
                      <strong className="text-[#eab308]">{m.senderName}:</strong>{' '}
                      <span className="text-[#f5ead8]">{m.text}</span>
                    </span>
                  ) : (
                    <span className="text-[#93c5fd]">[{m.category === 'trade' ? '거래' : '알림'}] {m.text}</span>
                  )}
                </div>
              ))}

            {rightTab !== 'CHAT' &&
              state.logs.map((log) => (
                <div key={log.id} className="leading-snug text-[#d6c3a5] border-b border-[#231710] pb-1">
                  <span className="text-[#b8a38d] mr-1.5">• </span>
                  {log.text}
                </div>
              ))}
          </div>

          <form onSubmit={handleChatSubmit} className="mt-2 flex gap-1.5 shrink-0">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              maxLength={200}
              placeholder="채팅 입력 (200자 이내)..."
              className="pixel-input px-2.5 py-1.5 text-xs flex-1 min-w-0"
            />
            <button
              type="submit"
              aria-label="채팅 보내기"
              className="pixel-btn px-2.5 py-1.5 bg-[#b45309] text-white cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </aside>
      </div>

      {/* Bottom Action Dock (Own Hand + Turn Actions) */}
      <footer className="px-3 py-2.5 bg-[#1d130d] border-t-3 border-[#0b0705] flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Player Hand (Hidden for Spectators) */}
        {!state.isSpectator && me ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="보유 자원 카드">
            {RESOURCE_TYPES.map((res) => (
              <div
                key={res}
                className="pixel-panel-dark px-2.5 py-1.5 flex items-center gap-2 text-xs"
                title={RESOURCE_LABELS_KO[res]}
              >
                <ResourcePixelIcon type={res} size={18} />
                <span className="text-[#d6c3a5]">{RESOURCE_LABELS_KO[res]}</span>
                <strong
                  className="text-sm text-[#fef3c7] tabular-nums"
                  data-testid={`res-count-${res}`}
                >
                  {myResources[res]}
                </strong>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setShowDevModal(true)}
              className="pixel-btn px-3 py-1.5 bg-[#312e81] text-[#e0e7ff] text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              발전카드 ({(me.devCards?.length ?? 0) + (me.newlyBoughtDevCards?.length ?? 0)})
            </button>
          </div>
        ) : (
          <div className="text-xs text-[#b8a38d]">
            관전 모드에서는 플레이어의 비공개 자원 및 숨겨진 발전 카드를 열람할 수 없습니다.
          </div>
        )}

        {/* Turn Action Controls */}
        {!state.isSpectator && (
          <div className="flex flex-wrap items-center gap-2">
            {state.phase === 'ROLL' && isMyTurn && (
              <button
                type="button"
                onClick={() => onDispatchAction({ type: 'ROLL_DICE', requestId: makeReqId() })}
                className="pixel-btn px-4 py-2 bg-[#eab308] text-[#1a120e] font-bold text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Dices className="w-4 h-4" /> 주사위 굴리기
              </button>
            )}

            <button
              type="button"
              disabled={!isMyTurn || state.phase !== 'MAIN' || !canAfford.road || (me?.roadsRemaining ?? 0) <= 0}
              onClick={() =>
                setInteractionMode((m) => (m === 'BUILD_ROAD' ? 'NONE' : 'BUILD_ROAD'))
              }
              className={`pixel-btn px-3 py-2 text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                interactionMode === 'BUILD_ROAD' ? 'bg-[#eab308] text-[#1a120e]' : 'bg-[#36251c] text-[#f5ead8]'
              }`}
              title="도로 건설: 나무 1 + 벽돌 1"
            >
              <Hammer className="w-3.5 h-3.5" /> 도로 (목1·벽1)
            </button>

            <button
              type="button"
              disabled={!isMyTurn || state.phase !== 'MAIN' || !canAfford.settlement || (me?.settlementsRemaining ?? 0) <= 0}
              onClick={() =>
                setInteractionMode((m) => (m === 'BUILD_SETTLEMENT' ? 'NONE' : 'BUILD_SETTLEMENT'))
              }
              className={`pixel-btn px-3 py-2 text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                interactionMode === 'BUILD_SETTLEMENT' ? 'bg-[#eab308] text-[#1a120e]' : 'bg-[#36251c] text-[#f5ead8]'
              }`}
              title="마을 건설: 나무 1 + 벽돌 1 + 양 1 + 밀 1"
            >
              <Home className="w-3.5 h-3.5" /> 마을 (목1·벽1·양1·밀1)
            </button>

            <button
              type="button"
              disabled={!isMyTurn || state.phase !== 'MAIN' || !canAfford.city || (me?.citiesRemaining ?? 0) <= 0}
              onClick={() =>
                setInteractionMode((m) => (m === 'UPGRADE_CITY' ? 'NONE' : 'UPGRADE_CITY'))
              }
              className={`pixel-btn px-3 py-2 text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                interactionMode === 'UPGRADE_CITY' ? 'bg-[#eab308] text-[#1a120e]' : 'bg-[#36251c] text-[#f5ead8]'
              }`}
              title="도시 업그레이드: 밀 2 + 철광석 3"
            >
              <Crown className="w-3.5 h-3.5" /> 도시 (밀2·철3)
            </button>

            <button
              type="button"
              disabled={!isMyTurn || state.phase !== 'MAIN' || !canAfford.dev || state.devDeckRemaining <= 0}
              onClick={() => onDispatchAction({ type: 'BUY_DEV_CARD', requestId: makeReqId() })}
              className="pixel-btn px-3 py-2 bg-[#4338ca] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              title="발전 카드 구매: 양 1 + 밀 1 + 철광석 1"
            >
              발전 구매 ({state.devDeckRemaining})
            </button>

            <button
              type="button"
              disabled={!isMyTurn || state.phase !== 'MAIN'}
              onClick={() => setShowTradeModal(true)}
              className="pixel-btn px-3 py-2 bg-[#0f766e] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" /> 교역
            </button>

            <button
              type="button"
              disabled={!isMyTurn || state.phase !== 'MAIN'}
              onClick={() => {
                setInteractionMode('NONE');
                onDispatchAction({ type: 'END_TURN', requestId: makeReqId() });
              }}
              className="pixel-btn px-4 py-2 bg-[#b45309] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Flag className="w-3.5 h-3.5" /> 턴 종료
            </button>
          </div>
        )}
      </footer>

      {/* Discard Modal (>7 cards on 7 roll) */}
      {mustDiscard && (
        <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-4">
          <div className="pixel-panel p-6 max-w-md w-full flex flex-col gap-4">
            <h2 className="text-lg font-bold text-[#f87171]">
              도둑 습격! 자원 {requiredDiscardCount}장을 버리세요
            </h2>
            <p className="text-xs text-[#d6c3a5]">
              주사위 합이 7이 되어 자원을 8장 이상 보유한 플레이어는 절반을 버려야 합니다. ({selectedDiscardCount} / {requiredDiscardCount})
            </p>
            <div className="flex flex-col gap-2">
              {RESOURCE_TYPES.map((r) => (
                <div key={r} className="pixel-panel-dark px-3 py-2 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <ResourcePixelIcon type={r} size={16} />
                    {RESOURCE_LABELS_KO[r]} (보유 {myResources[r]})
                  </span>
                  <div className="flex items-center gap-2 tabular-nums">
                    <button
                      type="button"
                      disabled={discardMap[r] <= 0}
                      onClick={() => setDiscardMap((d) => ({ ...d, [r]: d[r] - 1 }))}
                      className="pixel-btn px-2 py-0.5 bg-[#36251c] text-white cursor-pointer"
                    >
                      -
                    </button>
                    <span className="w-4 text-center font-bold">{discardMap[r]}</span>
                    <button
                      type="button"
                      disabled={discardMap[r] >= myResources[r] || selectedDiscardCount >= requiredDiscardCount}
                      onClick={() => setDiscardMap((d) => ({ ...d, [r]: d[r] + 1 }))}
                      className="pixel-btn px-2 py-0.5 bg-[#36251c] text-white cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={selectedDiscardCount !== requiredDiscardCount}
              onClick={handleSubmitDiscard}
              className="pixel-btn py-2.5 bg-[#b45309] text-white font-bold text-sm cursor-pointer"
            >
              선택한 자원 버리기
            </button>
          </div>
        </div>
      )}

      {/* Robber Steal Target Modal */}
      {isMyTurn && state.phase === 'ROBBER_STEAL' && (
        <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-4">
          <div className="pixel-panel p-6 max-w-sm w-full flex flex-col gap-4">
            <h2 className="text-lg font-bold text-[#fef3c7] flex items-center gap-2">
              <Swords className="w-5 h-5 text-[#ef4444]" /> 약탈할 플레이어 선택
            </h2>
            <p className="text-xs text-[#d6c3a5]">
              도둑을 놓은 타일에 인접한 플레이어 중 1명에게서 무작위 자원 1장을 가져옵니다.
            </p>
            <div className="flex flex-col gap-2">
              {state.stealCandidatePlayerIds.map((pid) => {
                const target = state.players.find((p) => p.id === pid);
                if (!target) return null;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() =>
                      onDispatchAction({
                        type: 'STEAL_RESOURCE',
                        targetPlayerId: pid,
                        requestId: makeReqId(),
                      })
                    }
                    className="pixel-btn px-4 py-2.5 bg-[#36251c] text-[#fef3c7] text-sm font-bold flex items-center justify-between cursor-pointer"
                  >
                    <span>{target.nickname}</span>
                    <span className="text-xs text-[#b8a38d]">보유 {target.resourceCount}장</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Trade Modal (Bank/Port + Player-to-Player Online Trade) */}
      {showTradeModal && (
        <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-4">
          <div className="pixel-panel p-6 max-w-lg w-full flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#fef3c7]">교역소</h2>
              <button
                type="button"
                onClick={() => setShowTradeModal(false)}
                className="pixel-btn px-2.5 py-1 bg-[#36251c] text-xs text-white cursor-pointer"
              >
                닫기
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTradeTab('BANK')}
                className={`pixel-btn py-2 text-xs font-bold cursor-pointer ${
                  tradeTab === 'BANK' ? 'bg-[#0f766e] text-white' : 'bg-[#231710] text-[#b8a38d]'
                }`}
              >
                은행 / 항구 교역
              </button>
              <button
                type="button"
                onClick={() => setTradeTab('PLAYER')}
                className={`pixel-btn py-2 text-xs font-bold cursor-pointer ${
                  tradeTab === 'PLAYER' ? 'bg-[#b45309] text-white' : 'bg-[#231710] text-[#b8a38d]'
                }`}
              >
                플레이어 간 거래 제안
              </button>
            </div>

            {tradeTab === 'BANK' ? (
              <div className="flex flex-col gap-3 text-xs">
                <div className="pixel-panel-dark p-3 text-[#d6c3a5]">
                  현재 <strong>{RESOURCE_LABELS_KO[bankGive]}</strong> 교역 비율:{' '}
                  <strong className="text-[#eab308]">{effectiveRatio}:1</strong> (항구 보유 시 자동 할인)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    낼 자원 ({effectiveRatio}장)
                    <select
                      value={bankGive}
                      onChange={(e) => setBankGive(e.target.value as ResourceType)}
                      className="pixel-input px-3 py-2"
                    >
                      {RESOURCE_TYPES.map((r) => (
                        <option key={r} value={r}>
                          {RESOURCE_LABELS_KO[r]} (보유 {myResources[r]})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    받을 자원 (1장)
                    <select
                      value={bankWant}
                      onChange={(e) => setBankWant(e.target.value as ResourceType)}
                      className="pixel-input px-3 py-2"
                    >
                      {RESOURCE_TYPES.map((r) => (
                        <option key={r} value={r}>
                          {RESOURCE_LABELS_KO[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  disabled={bankGive === bankWant || myResources[bankGive] < effectiveRatio}
                  onClick={handleBankTrade}
                  className="pixel-btn py-2.5 bg-[#0f766e] text-white font-bold text-sm cursor-pointer"
                >
                  {RESOURCE_LABELS_KO[bankGive]} {effectiveRatio}장 → {RESOURCE_LABELS_KO[bankWant]} 1장 교환
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="pixel-panel-dark p-3 flex flex-col gap-2">
                    <div className="font-bold text-[#86efac]">내가 줄 자원</div>
                    {RESOURCE_TYPES.map((r) => (
                      <div key={r} className="flex items-center justify-between">
                        <span>{RESOURCE_LABELS_KO[r]} ({myResources[r]})</span>
                        <div className="flex items-center gap-1 tabular-nums">
                          <button
                            type="button"
                            onClick={() =>
                              setOfferGive((g) => ({ ...g, [r]: Math.max(0, g[r] - 1) }))
                            }
                            className="pixel-btn px-1.5 bg-[#36251c] text-white cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-4 text-center">{offerGive[r]}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setOfferGive((g) => ({
                                ...g,
                                [r]: Math.min(myResources[r], g[r] + 1),
                              }))
                            }
                            className="pixel-btn px-1.5 bg-[#36251c] text-white cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pixel-panel-dark p-3 flex flex-col gap-2">
                    <div className="font-bold text-[#fca5a5]">내가 받을 자원</div>
                    {RESOURCE_TYPES.map((r) => (
                      <div key={r} className="flex items-center justify-between">
                        <span>{RESOURCE_LABELS_KO[r]}</span>
                        <div className="flex items-center gap-1 tabular-nums">
                          <button
                            type="button"
                            onClick={() =>
                              setOfferWant((w) => ({ ...w, [r]: Math.max(0, w[r] - 1) }))
                            }
                            className="pixel-btn px-1.5 bg-[#36251c] text-white cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-4 text-center">{offerWant[r]}</span>
                          <button
                            type="button"
                            onClick={() => setOfferWant((w) => ({ ...w, [r]: w[r] + 1 }))}
                            className="pixel-btn px-1.5 bg-[#36251c] text-white cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={
                    getTotalResourceCount(offerGive) === 0 || getTotalResourceCount(offerWant) === 0
                  }
                  onClick={handleProposePlayerTrade}
                  className="pixel-btn py-2.5 bg-[#b45309] text-white font-bold text-sm cursor-pointer"
                >
                  전체 플레이어에게 거래 제안 보내기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dev Cards Inventory Modal */}
      {showDevModal && me && (
        <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-4">
          <div className="pixel-panel p-6 max-w-md w-full flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#fef3c7] flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#60a5fa]" /> 내 발전 카드
              </h2>
              <button
                type="button"
                onClick={() => setShowDevModal(false)}
                className="pixel-btn px-2.5 py-1 bg-[#36251c] text-xs text-white cursor-pointer"
              >
                닫기
              </button>
            </div>
            <div className="flex flex-col gap-2 text-xs">
              {(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'] as DevCardType[]).map(
                (card) => {
                  const count = myPlayableDevCounts[card];
                  const canPlay =
                    isMyTurn &&
                    count > 0 &&
                    card !== 'victoryPoint' &&
                    !state.devCardPlayedThisTurn &&
                    (state.phase === 'MAIN' || (state.phase === 'ROLL' && card === 'knight'));
                  return (
                    <div
                      key={card}
                      className="pixel-panel-dark px-3 py-2.5 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-bold text-[#fef3c7]">
                          {DEV_CARD_LABELS_KO[card]} ({count}장)
                        </div>
                        <div className="text-[#b8a38d] text-[11px]">
                          {card === 'knight' && '도둑을 이동시키고 1장을 약탈합니다.'}
                          {card === 'roadBuilding' && '무료 도로 2개를 즉시 건설합니다.'}
                          {card === 'yearOfPlenty' && '원하는 자원 2장을 은행에서 가져옵니다.'}
                          {card === 'monopoly' && '지정한 자원 1종을 모든 상대에게서 독점합니다.'}
                          {card === 'victoryPoint' && '보유 즉시 승점 +1점 (자동 반영)'}
                        </div>
                      </div>
                      {card !== 'victoryPoint' && (
                        <button
                          type="button"
                          disabled={!canPlay}
                          onClick={() => handlePlayDevCard(card)}
                          className="pixel-btn px-3 py-1.5 bg-[#4338ca] text-white font-bold cursor-pointer"
                        >
                          사용
                        </button>
                      )}
                    </div>
                  );
                }
              )}
              {(me.newlyBoughtDevCards?.length ?? 0) > 0 && (
                <p className="text-[11px] text-[#facc15]">
                  * 이번 턴에 구매한 발전 카드 {me.newlyBoughtDevCards?.length}장은 다음 턴부터 사용할 수 있습니다.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Year of Plenty / Monopoly Resource Picker */}
      {devPickCard && (
        <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-4">
          <div className="pixel-panel p-6 max-w-sm w-full flex flex-col gap-4 text-xs">
            <h2 className="text-base font-bold text-[#fef3c7]">
              {devPickCard === 'yearOfPlenty' ? '풍요의 해: 자원 2개 선택' : '독점: 자원 1종 선택'}
            </h2>
            {devPickCard === 'yearOfPlenty' ? (
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={yopPicks[0]}
                  onChange={(e) => setYopPicks([e.target.value as ResourceType, yopPicks[1]])}
                  className="pixel-input px-2 py-2"
                >
                  {RESOURCE_TYPES.map((r) => (
                    <option key={r} value={r}>
                      {RESOURCE_LABELS_KO[r]}
                    </option>
                  ))}
                </select>
                <select
                  value={yopPicks[1]}
                  onChange={(e) => setYopPicks([yopPicks[0], e.target.value as ResourceType])}
                  className="pixel-input px-2 py-2"
                >
                  {RESOURCE_TYPES.map((r) => (
                    <option key={r} value={r}>
                      {RESOURCE_LABELS_KO[r]}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <select
                value={monoPick}
                onChange={(e) => setMonoPick(e.target.value as ResourceType)}
                className="pixel-input px-2 py-2"
              >
                {RESOURCE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {RESOURCE_LABELS_KO[r]}
                  </option>
                ))}
              </select>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDevPickCard(null)}
                className="pixel-btn px-3 py-2 bg-[#36251c] text-white cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  const chosen = devPickCard === 'yearOfPlenty' ? yopPicks : [monoPick];
                  const card = devPickCard;
                  setDevPickCard(null);
                  await onDispatchAction({
                    type: 'PLAY_DEV_CARD',
                    card,
                    resources: chosen,
                    requestId: makeReqId(),
                  });
                }}
                className="pixel-btn px-4 py-2 bg-[#4338ca] text-white font-bold cursor-pointer"
              >
                카드 발동
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Victory Modal (Requirement 21-15 #8: identical result across all players) */}
      {state.phase === 'GAME_OVER' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="pixel-panel p-7 max-w-md w-full flex flex-col gap-5 text-center">
            <div className="flex flex-col items-center gap-2">
              <Trophy className="w-12 h-12 text-[#eab308]" />
              <h2 className="text-2xl font-bold text-[#fef3c7]">게임 종료 · 승리 확정!</h2>
              <p className="text-sm text-[#fde68a]">
                {state.players.find((p) => p.id === state.winnerId)?.nickname ?? '우승자'}님이 목표 승점을 달성했습니다!
              </p>
            </div>

            <div className="flex flex-col gap-2 text-left text-xs">
              {[...state.players]
                .sort((a, b) => (b.totalVP ?? b.publicVP) - (a.totalVP ?? a.publicVP))
                .map((p, idx) => (
                  <div
                    key={p.id}
                    className="pixel-panel-dark px-3.5 py-2.5 flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2 font-bold text-[#fef3c7]">
                      <span className="tabular-nums text-[#eab308]">{idx + 1}위</span>
                      <span
                        className="w-3 h-3 border border-black"
                        style={{ backgroundColor: PLAYER_COLOR_HEX[p.color].primary }}
                      />
                      {p.nickname}
                    </span>
                    <span className="font-bold text-[#eab308] tabular-nums">
                      {p.totalVP ?? p.publicVP}점
                    </span>
                  </div>
                ))}
            </div>

            <div className="flex gap-3 justify-center">
              {onPlayAgain && (
                <button
                  type="button"
                  data-start="true"
                  onClick={onPlayAgain}
                  className="pixel-btn px-5 py-2.5 bg-[#15803d] text-white font-bold text-sm cursor-pointer"
                >
                  다시 하기
                </button>
              )}
              <button
                type="button"
                onClick={onLeaveGame}
                className="pixel-btn px-5 py-2.5 bg-[#36251c] text-[#f5ead8] font-bold text-sm cursor-pointer"
              >
                메인 메뉴로
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
