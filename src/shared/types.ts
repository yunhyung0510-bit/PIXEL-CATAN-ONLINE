export type ResourceType = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';

export const RESOURCE_TYPES: ResourceType[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const RESOURCE_LABELS_KO: Record<ResourceType, string> = {
  wood: '나무',
  brick: '벽돌',
  sheep: '양',
  wheat: '밀',
  ore: '철광석',
};

export type TerrainType = 'forest' | 'hills' | 'pasture' | 'fields' | 'mountains' | 'desert';

export const TERRAIN_TO_RESOURCE: Record<TerrainType, ResourceType | null> = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'sheep',
  fields: 'wheat',
  mountains: 'ore',
  desert: null,
};

export const TERRAIN_LABELS_KO: Record<TerrainType, string> = {
  forest: '숲',
  hills: '언덕',
  pasture: '초원',
  fields: '농지',
  mountains: '산',
  desert: '사막',
};

export type PlayerColor = 'red' | 'blue' | 'green' | 'amber';

export const PLAYER_COLORS: PlayerColor[] = ['red', 'blue', 'green', 'amber'];

export const PLAYER_COLOR_HEX: Record<PlayerColor, { primary: string; light: string; dark: string; label: string }> = {
  red: { primary: '#ef4444', light: '#fca5a5', dark: '#991b1b', label: '크림슨 레드' },
  blue: { primary: '#3b82f6', light: '#93c5fd', dark: '#1e40af', label: '로열 블루' },
  green: { primary: '#22c55e', light: '#86efac', dark: '#166534', label: '포레스트 그린' },
  amber: { primary: '#f59e0b', light: '#fcd34d', dark: '#92400e', label: '앰버 골드' },
};

export type DevCardType = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint';

export const DEV_CARD_LABELS_KO: Record<DevCardType, string> = {
  knight: '기사',
  roadBuilding: '도로 건설',
  yearOfPlenty: '풍요의 해',
  monopoly: '독점',
  victoryPoint: '승점 카드',
};

export type ResourceMap = Record<ResourceType, number>;

export function createEmptyResources(): ResourceMap {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export type GamePhase =
  | 'SETUP_SETTLEMENT'
  | 'SETUP_ROAD'
  | 'ROLL'
  | 'DISCARD'
  | 'ROBBER_MOVE'
  | 'ROBBER_STEAL'
  | 'MAIN'
  | 'GAME_OVER';

export type AIDifficulty = 'easy' | 'normal' | 'hard';
export type BoardMode = 'standard' | 'random';
export type GameMode = 'single' | 'ai' | 'multiplayer';

export interface HexTile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  terrain: TerrainType;
  numberToken: number | null;
  vertexIds: string[];
  edgeIds: string[];
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
  adjacentVertexIds: string[];
  adjacentEdgeIds: string[];
  adjacentHexIds: number[];
  portId: string | null;
  ownerId: string | null;
  building: 'settlement' | 'city' | null;
}

export interface Edge {
  id: string;
  v1: string;
  v2: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
  ownerId: string | null;
}

export type PortKind = 'generic' | ResourceType;

export interface Port {
  id: string;
  kind: PortKind;
  ratio: 2 | 3;
  edgeId: string;
  vertexIds: [string, string];
  x: number;
  y: number;
  angle: number;
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  targetPlayerId: string | null; // null = open to all players
  give: ResourceMap;
  want: ResourceMap;
  rejectedBy: string[];
  createdAt: number;
}

export interface GameLogEntry {
  id: string;
  timestamp: number;
  type: 'system' | 'dice' | 'build' | 'trade' | 'dev' | 'robber' | 'victory';
  text: string;
}

export interface PlayerGameState {
  id: string;
  nickname: string;
  color: PlayerColor;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  connected: boolean;
  resources: ResourceMap;
  devCards: DevCardType[]; // Unplayed dev cards (including victoryPoint)
  newlyBoughtDevCards: DevCardType[]; // Bought this turn, cannot play non-VP this turn
  playedKnights: number;
  roadsRemaining: number;
  settlementsRemaining: number;
  citiesRemaining: number;
  longestRoadLength: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  publicVP: number;
  totalVP: number;
}

export interface PublicPlayerGameState {
  id: string;
  nickname: string;
  color: PlayerColor;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  connected: boolean;
  resourceCount: number;
  devCardCount: number;
  playedKnights: number;
  roadsRemaining: number;
  settlementsRemaining: number;
  citiesRemaining: number;
  longestRoadLength: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
  publicVP: number;
  totalVP?: number; // Only exposed to self or everyone on GAME_OVER
  resources?: ResourceMap; // Only exposed to self
  devCards?: DevCardType[]; // Only exposed to self
  newlyBoughtDevCards?: DevCardType[]; // Only exposed to self
}

export interface GameState {
  id: string;
  roomId: string;
  victoryPointsTarget: number;
  phase: GamePhase;
  turnNumber: number;
  currentPlayerIndex: number;
  setupRound: 1 | 2;
  setupLastSettlementVertexId: string | null;
  dice: [number, number] | null;
  robberHexId: number;
  robberFromKnight: boolean;
  pendingDiscardPlayerIds: string[];
  stealCandidatePlayerIds: string[];
  devCardDeck: DevCardType[];
  devCardPlayedThisTurn: boolean;
  freeRoadsRemaining: number;
  activeTradeOffers: TradeOffer[];
  hexes: HexTile[];
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;
  ports: Port[];
  players: PlayerGameState[];
  playerOrder: string[];
  winnerId: string | null;
  logs: GameLogEntry[];
  processedRequestIds: string[];
  startedAt: number;
  endedAt: number | null;
}

export interface ClientGameState {
  id: string;
  roomId: string;
  victoryPointsTarget: number;
  phase: GamePhase;
  turnNumber: number;
  currentPlayerIndex: number;
  setupRound: 1 | 2;
  setupLastSettlementVertexId: string | null;
  dice: [number, number] | null;
  robberHexId: number;
  pendingDiscardPlayerIds: string[];
  stealCandidatePlayerIds: string[];
  devDeckRemaining: number;
  devCardPlayedThisTurn: boolean;
  freeRoadsRemaining: number;
  activeTradeOffers: TradeOffer[];
  hexes: HexTile[];
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;
  ports: Port[];
  players: PublicPlayerGameState[];
  playerOrder: string[];
  winnerId: string | null;
  logs: GameLogEntry[];
  startedAt: number;
  endedAt: number | null;
  viewerId: string;
  isSpectator: boolean;
}

export type GameActionPayload =
  | { type: 'PLACE_SETUP_SETTLEMENT'; vertexId: string; requestId: string }
  | { type: 'PLACE_SETUP_ROAD'; edgeId: string; requestId: string }
  | { type: 'ROLL_DICE'; requestId: string }
  | { type: 'DISCARD_RESOURCES'; resources: ResourceMap; requestId: string }
  | { type: 'MOVE_ROBBER'; hexId: number; requestId: string }
  | { type: 'STEAL_RESOURCE'; targetPlayerId: string; requestId: string }
  | { type: 'BUILD_ROAD'; edgeId: string; requestId: string }
  | { type: 'BUILD_SETTLEMENT'; vertexId: string; requestId: string }
  | { type: 'UPGRADE_CITY'; vertexId: string; requestId: string }
  | { type: 'BUY_DEV_CARD'; requestId: string }
  | {
      type: 'PLAY_DEV_CARD';
      card: Exclude<DevCardType, 'victoryPoint'>;
      resources?: ResourceType[]; // For Year of Plenty (2) or Monopoly (1)
      requestId: string;
    }
  | { type: 'BANK_TRADE'; give: ResourceType; giveAmount: number; want: ResourceType; requestId: string }
  | {
      type: 'OFFER_TRADE';
      give: ResourceMap;
      want: ResourceMap;
      targetPlayerId?: string | null;
      requestId: string;
    }
  | { type: 'ACCEPT_TRADE'; offerId: string; requestId: string }
  | { type: 'REJECT_TRADE'; offerId: string; requestId: string }
  | { type: 'CANCEL_TRADE'; offerId: string; requestId: string }
  | { type: 'END_TURN'; requestId: string };

export interface RoomSettings {
  roomName: string;
  isPublic: boolean;
  maxPlayers: number; // 2..4
  allowAI: boolean;
  aiDifficulty: AIDifficulty;
  boardMode: BoardMode;
  victoryPointsTarget: number; // 8, 10, 12
  restrictJoinDuringGame: boolean;
  allowSpectators: boolean;
}

export interface RoomPlayer {
  id: string;
  nickname: string;
  color: PlayerColor;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  isReady: boolean;
  isHost: boolean;
  connected: boolean;
  seatOrder: number;
  disconnectedAt: number | null;
}

export interface SpectatorInfo {
  id: string;
  nickname: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  category: 'chat' | 'system' | 'trade' | 'lifecycle';
  text: string;
  timestamp: number;
}

export interface GameRoom {
  id: string;
  code: string;
  hostId: string;
  mode: GameMode;
  status: 'waiting' | 'playing' | 'finished';
  settings: RoomSettings;
  players: RoomPlayer[];
  spectators: SpectatorInfo[];
  chatMessages: ChatMessage[];
  createdAt: number;
}

export interface PublicRoomSummary {
  id: string;
  code: string;
  roomName: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'finished';
  isPublic: boolean;
  allowSpectators: boolean;
  aiDifficulty: AIDifficulty;
  victoryPointsTarget: number;
}

export interface GameRecordPlayer {
  playerId: string;
  nickname: string;
  color: PlayerColor;
  isAI: boolean;
  finalVP: number;
  rank: number;
}

export interface GameRecord {
  id: string;
  roomId: string;
  roomName: string;
  mode: GameMode;
  winnerId: string;
  winnerNickname: string;
  players: GameRecordPlayer[];
  startedAt: number;
  endedAt: number;
  turnCount: number;
}

export interface UserProfile {
  id: string;
  nickname: string;
  createdAt: number;
}
