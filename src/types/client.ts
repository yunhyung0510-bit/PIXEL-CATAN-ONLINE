import { AIDifficulty, BoardMode } from '../shared/types';

export type AppScreen =
  | 'TITLE'
  | 'MULTIPLAYER_HUB'
  | 'LOBBY'
  | 'PLAYING'
  | 'RECORDS'
  | 'SETTINGS';

export type BuildInteractionMode =
  | 'NONE'
  | 'BUILD_ROAD'
  | 'BUILD_SETTLEMENT'
  | 'UPGRADE_CITY'
  | 'MOVE_ROBBER';

export interface ClientSettings {
  soundEnabled: boolean;
  defaultDifficulty: AIDifficulty;
  defaultBoardMode: BoardMode;
  defaultVictoryPoints: number;
  showBuildHints: boolean;
}

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  soundEnabled: true,
  defaultDifficulty: 'normal',
  defaultBoardMode: 'random',
  defaultVictoryPoints: 10,
  showBuildHints: true,
};
