import React from 'react';
import {
  ClientGameState,
  HexTile,
  PLAYER_COLOR_HEX,
  RESOURCE_LABELS_KO,
  TerrainType,
} from '../shared/types';
import {
  getValidCityVertices,
  getValidRoadEdges,
  getValidSettlementVertices,
  getValidSetupRoadEdges,
  getValidSetupSettlementVertices,
} from '../shared/catan';
import { BuildInteractionMode } from '../types/client';
import { HEX_SIZE } from '../shared/board';

interface HexBoardProps {
  state: ClientGameState;
  interactionMode: BuildInteractionMode;
  onSelectHex: (hexId: number) => void;
  onSelectVertex: (vertexId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

const TERRAIN_PALETTE: Record<
  TerrainType,
  { base: string; accent: string; stroke: string; label: string }
> = {
  forest: { base: '#166534', accent: '#22c55e', stroke: '#052e16', label: '숲' },
  hills: { base: '#9a3412', accent: '#ea580c', stroke: '#431407', label: '언덕' },
  pasture: { base: '#4d7c0f', accent: '#a3e635', stroke: '#1a2e05', label: '초원' },
  fields: { base: '#ca8a04', accent: '#facc15', stroke: '#422006', label: '농지' },
  mountains: { base: '#475569', accent: '#94a3b8', stroke: '#1e293b', label: '산' },
  desert: { base: '#a16207', accent: '#fde047', stroke: '#451a03', label: '사막' },
};

function getHexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function renderTerrainPixelArt(hex: HexTile) {
  const { x, y, terrain } = hex;
  switch (terrain) {
    case 'forest':
      return (
        <g pointerEvents="none" opacity="0.9">
          <polygon points={`${x - 16},${y - 10} ${x - 23},${y + 4} ${x - 9},${y + 4}`} fill="#14532d" />
          <polygon points={`${x + 15},${y - 14} ${x + 8},${y} ${x + 22},${y}`} fill="#15803d" />
          <rect x={x - 18} y={y + 4} width="4" height="5" fill="#7c3f1d" />
          <rect x={x + 13} y={y} width="4" height="5" fill="#7c3f1d" />
          <polygon points={`${x},${y - 26} ${x - 7},${y - 12} ${x + 7},${y - 12}`} fill="#22c55e" />
        </g>
      );
    case 'hills':
      return (
        <g pointerEvents="none" opacity="0.85">
          <rect x={x - 22} y={y - 14} width="16" height="8" fill="#c2410c" />
          <rect x={x + 6} y={y - 8} width="16" height="8" fill="#ea580c" />
          <rect x={x - 14} y={y + 10} width="24" height="6" fill="#7c2d12" />
        </g>
      );
    case 'pasture':
      return (
        <g pointerEvents="none" opacity="0.9">
          <rect x={x - 20} y={y - 16} width="8" height="6" fill="#f8fafc" />
          <rect x={x - 14} y={y - 14} width="3" height="3" fill="#334155" />
          <rect x={x + 12} y={y + 8} width="8" height="6" fill="#f8fafc" />
          <rect x={x + 18} y={y + 10} width="3" height="3" fill="#334155" />
          <rect x={x - 4} y={y - 26} width="4" height="4" fill="#bef264" />
        </g>
      );
    case 'fields':
      return (
        <g pointerEvents="none" opacity="0.85">
          <rect x={x - 22} y={y - 16} width="4" height="12" fill="#fde047" />
          <rect x={x - 14} y={y - 18} width="4" height="14" fill="#fef08a" />
          <rect x={x + 10} y={y - 16} width="4" height="12" fill="#fde047" />
          <rect x={x + 18} y={y - 14} width="4" height="10" fill="#eab308" />
        </g>
      );
    case 'mountains':
      return (
        <g pointerEvents="none" opacity="0.95">
          <polygon points={`${x - 14},${y - 24} ${x - 30},${y + 8} ${x + 2},${y + 8}`} fill="#334155" />
          <polygon points={`${x - 14},${y - 24} ${x - 20},${y - 12} ${x - 8},${y - 12}`} fill="#e2e8f0" />
          <polygon points={`${x + 14},${y - 20} ${x - 2},${y + 10} ${x + 30},${y + 10}`} fill="#1e293b" />
          <polygon points={`${x + 14},${y - 20} ${x + 9},${y - 10} ${x + 19},${y - 10}`} fill="#f8fafc" />
        </g>
      );
    case 'desert':
      return (
        <g pointerEvents="none" opacity="0.9">
          <rect x={x - 18} y={y - 12} width="4" height="14" fill="#15803d" />
          <rect x={x - 22} y={y - 8} width="4" height="4" fill="#15803d" />
          <rect x={x - 14} y={y - 10} width="4" height="4" fill="#15803d" />
          <rect x={x + 10} y={y + 10} width="16" height="4" fill="#854d0e" />
        </g>
      );
  }
}

export const HexBoard: React.FC<HexBoardProps> = ({
  state,
  interactionMode,
  onSelectHex,
  onSelectVertex,
  onSelectEdge,
}) => {
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === state.viewerId && !state.isSpectator;

  const validVertices = new Set<string>();
  const validEdges = new Set<string>();
  let canMoveRobber = false;

  if (isMyTurn) {
    if (state.phase === 'SETUP_SETTLEMENT') {
      getValidSetupSettlementVertices(state as never).forEach((id) => validVertices.add(id));
    } else if (state.phase === 'SETUP_ROAD') {
      getValidSetupRoadEdges(state as never, state.setupLastSettlementVertexId).forEach((id) =>
        validEdges.add(id)
      );
    } else if (state.phase === 'ROBBER_MOVE' || interactionMode === 'MOVE_ROBBER') {
      canMoveRobber = true;
    } else if (state.phase === 'MAIN') {
      if (interactionMode === 'BUILD_ROAD' || state.freeRoadsRemaining > 0) {
        getValidRoadEdges(state as never, state.viewerId).forEach((id) => validEdges.add(id));
      } else if (interactionMode === 'BUILD_SETTLEMENT') {
        getValidSettlementVertices(state as never, state.viewerId).forEach((id) =>
          validVertices.add(id)
        );
      } else if (interactionMode === 'UPGRADE_CITY') {
        getValidCityVertices(state as never, state.viewerId).forEach((id) =>
          validVertices.add(id)
        );
      }
    }
  }

  const playerMap = new Map(state.players.map((p) => [p.id, p]));
  const lastDiceSum = state.dice ? state.dice[0] + state.dice[1] : null;

  return (
    <div
      className="relative w-full h-full flex items-center justify-center select-none overflow-hidden"
      data-testid="catan-board"
    >
      <svg
        viewBox="-295 -270 590 540"
        className="w-full h-full max-w-[740px] max-h-[660px] drop-shadow-[0_10px_0_rgba(0,0,0,0.45)]"
        role="img"
        aria-label="카탄 19타일 픽셀 보드"
      >
        <defs>
          <pattern id="pixel-ocean" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" fill="#0f2537" />
            <rect x="2" y="4" width="6" height="2" fill="#163750" />
            <rect x="10" y="12" width="4" height="2" fill="#1d496a" />
          </pattern>
        </defs>

        {/* Outer Pixel Island Sea Frame */}
        <polygon
          points={getHexPoints(0, 0, 266)}
          fill="url(#pixel-ocean)"
          stroke="#5c3f2e"
          strokeWidth="6"
        />
        <polygon
          points={getHexPoints(0, 0, 258)}
          fill="none"
          stroke="#eab308"
          strokeWidth="2"
          opacity="0.45"
        />

        {/* Ports (rendered behind coastal vertices with pixel docks) */}
        {state.ports.map((port) => {
          const v1 = state.vertices[port.vertexIds[0]];
          const v2 = state.vertices[port.vertexIds[1]];
          const portLabel =
            port.kind === 'generic'
              ? '3:1'
              : `2:1 ${RESOURCE_LABELS_KO[port.kind]}`;
          return (
            <g key={port.id}>
              {v1 && (
                <line
                  x1={port.x}
                  y1={port.y}
                  x2={v1.x}
                  y2={v1.y}
                  stroke="#7c3f1d"
                  strokeWidth="4"
                  strokeDasharray="4 3"
                />
              )}
              {v2 && (
                <line
                  x1={port.x}
                  y1={port.y}
                  x2={v2.x}
                  y2={v2.y}
                  stroke="#7c3f1d"
                  strokeWidth="4"
                  strokeDasharray="4 3"
                />
              )}
              <rect
                x={port.x - 22}
                y={port.y - 11}
                width="44"
                height="22"
                fill={port.kind === 'generic' ? '#231710' : '#312e81'}
                stroke="#eab308"
                strokeWidth="2"
              />
              <text
                x={port.x}
                y={port.y + 4}
                textAnchor="middle"
                fill="#fef3c7"
                fontSize="9"
                fontWeight="700"
              >
                {portLabel}
              </text>
            </g>
          );
        })}

        {/* 19 Resource Hexes */}
        {state.hexes.map((hex) => {
          const palette = TERRAIN_PALETTE[hex.terrain];
          const isRobberHere = state.robberHexId === hex.id;
          const isHighlightedRoll = lastDiceSum !== null && hex.numberToken === lastDiceSum && !isRobberHere;
          const isValidRobberTarget = canMoveRobber && !isRobberHere;
          const pips = hex.numberToken ? 6 - Math.abs(7 - hex.numberToken) : 0;
          const isHot = hex.numberToken === 6 || hex.numberToken === 8;

          return (
            <g
              key={hex.id}
              onClick={() => isValidRobberTarget && onSelectHex(hex.id)}
              className={isValidRobberTarget ? 'cursor-pointer' : undefined}
            >
              <polygon
                points={getHexPoints(hex.x, hex.y, HEX_SIZE - 1)}
                fill={palette.base}
                stroke={
                  isValidRobberTarget
                    ? '#facc15'
                    : isHighlightedRoll
                    ? '#fef08a'
                    : '#0d0806'
                }
                strokeWidth={isValidRobberTarget || isHighlightedRoll ? 3.5 : 2.5}
              />
              {/* Inner pixel bevel */}
              <polygon
                points={getHexPoints(hex.x, hex.y, HEX_SIZE - 5)}
                fill="none"
                stroke={palette.accent}
                strokeWidth="1.5"
                opacity="0.35"
              />

              {renderTerrainPixelArt(hex)}

              {/* Terrain name label */}
              <text
                x={hex.x}
                y={hex.y + 28}
                textAnchor="middle"
                fill="#fef3c7"
                fontSize="8.5"
                fontWeight="700"
                opacity="0.88"
                pointerEvents="none"
              >
                {palette.label}
              </text>

              {/* Number Chip */}
              {hex.numberToken !== null && (
                <g pointerEvents="none">
                  <rect
                    x={hex.x - 14}
                    y={hex.y - 13}
                    width="28"
                    height="24"
                    fill={isHighlightedRoll ? '#fef08a' : '#f5ead8'}
                    stroke="#0d0806"
                    strokeWidth="2"
                  />
                  <text
                    x={hex.x}
                    y={hex.y + 3}
                    textAnchor="middle"
                    fill={isHot ? '#dc2626' : '#1a120e'}
                    fontSize="13"
                    fontWeight="900"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {hex.numberToken}
                  </text>
                  {/* Probability dots */}
                  <g>
                    {Array.from({ length: pips }).map((_, i) => (
                      <rect
                        key={i}
                        x={hex.x - (pips * 3.5) / 2 + i * 3.5}
                        y={hex.y + 6}
                        width="2.2"
                        height="2.2"
                        fill={isHot ? '#dc2626' : '#5c3f2e'}
                      />
                    ))}
                  </g>
                </g>
              )}

              {/* Robber Sprite */}
              {isRobberHere && (
                <g pointerEvents="none">
                  <rect x={hex.x - 11} y={hex.y - 26} width="22" height="24" fill="#090504" opacity="0.55" />
                  <rect x={hex.x - 8} y={hex.y - 28} width="16" height="10" fill="#1f2937" stroke="#000" strokeWidth="1.5" />
                  <rect x={hex.x - 10} y={hex.y - 18} width="20" height="14" fill="#111827" stroke="#000" strokeWidth="1.5" />
                  <rect x={hex.x - 5} y={hex.y - 24} width="3" height="2" fill="#ef4444" />
                  <rect x={hex.x + 2} y={hex.y - 24} width="3" height="2" fill="#ef4444" />
                  <text
                    x={hex.x}
                    y={hex.y - 31}
                    textAnchor="middle"
                    fill="#f87171"
                    fontSize="8"
                    fontWeight="900"
                  >
                    도둑
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Edges (Roads & Valid Road Build Targets) */}
        {Object.values(state.edges).map((edge) => {
          const owner = edge.ownerId ? playerMap.get(edge.ownerId) : null;
          const isValid = validEdges.has(edge.id);

          if (!owner && !isValid) return null;

          const color = owner ? PLAYER_COLOR_HEX[owner.color].primary : '#facc15';
          const outline = owner ? '#0d0806' : '#713f12';

          const cx = (edge.x1 + edge.x2) / 2;
          const cy = (edge.y1 + edge.y2) / 2;
          const len = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
          const deg = (Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) * 180) / Math.PI;

          return (
            <g
              key={edge.id}
              onClick={() => isValid && onSelectEdge(edge.id)}
              className={isValid ? 'cursor-pointer' : undefined}
              data-testid={isValid ? `valid-edge-${edge.id}` : `edge-${edge.id}`}
            >
              {/* 2D hit target (rotated rect ensures non-zero bbox even for vertical edges) */}
              {isValid && (
                <rect
                  x={-len / 2}
                  y={-9}
                  width={len}
                  height={18}
                  fill="rgba(250, 204, 21, 0.14)"
                  transform={`translate(${cx}, ${cy}) rotate(${deg})`}
                />
              )}
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={outline}
                strokeWidth={owner ? 9 : 8}
                strokeLinecap="square"
                strokeDasharray={isValid ? '5 4' : undefined}
              />
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={color}
                strokeWidth={owner ? 5 : 4}
                strokeLinecap="square"
                strokeDasharray={isValid ? '5 4' : undefined}
              />
            </g>
          );
        })}

        {/* Vertices (Settlements, Cities, & Valid Build Targets) */}
        {Object.values(state.vertices).map((vertex) => {
          const owner = vertex.ownerId ? playerMap.get(vertex.ownerId) : null;
          const isValid = validVertices.has(vertex.id);

          if (!owner && !isValid) return null;

          const palette = owner ? PLAYER_COLOR_HEX[owner.color] : null;

          return (
            <g
              key={vertex.id}
              onClick={() => isValid && onSelectVertex(vertex.id)}
              className={isValid ? 'cursor-pointer' : undefined}
              data-testid={isValid ? `valid-vertex-${vertex.id}` : `vertex-${vertex.id}`}
            >
              {/* Generous hit target */}
              {isValid && (
                <circle cx={vertex.x} cy={vertex.y} r="15" fill="rgba(250, 204, 21, 0.22)" />
              )}

              {isValid && !owner && (
                <rect
                  x={vertex.x - 7}
                  y={vertex.y - 7}
                  width="14"
                  height="14"
                  fill="#facc15"
                  stroke="#0d0806"
                  strokeWidth="2"
                />
              )}

              {owner && vertex.building === 'settlement' && palette && (
                <g>
                  <polygon
                    points={`${vertex.x},${vertex.y - 11} ${vertex.x + 9},${vertex.y - 3} ${vertex.x + 9},${vertex.y + 8} ${vertex.x - 9},${vertex.y + 8} ${vertex.x - 9},${vertex.y - 3}`}
                    fill={palette.primary}
                    stroke={isValid ? '#fef08a' : '#0d0806'}
                    strokeWidth={isValid ? 3 : 2}
                  />
                  <rect x={vertex.x - 2} y={vertex.y + 1} width="4" height="6" fill="#0d0806" />
                </g>
              )}

              {owner && vertex.building === 'city' && palette && (
                <g>
                  <polygon
                    points={`${vertex.x - 11},${vertex.y - 6} ${vertex.x - 6},${vertex.y - 13} ${vertex.x - 1},${vertex.y - 6} ${vertex.x + 11},${vertex.y - 6} ${vertex.x + 11},${vertex.y + 10} ${vertex.x - 11},${vertex.y + 10}`}
                    fill={palette.primary}
                    stroke="#fef08a"
                    strokeWidth="2"
                  />
                  <rect x={vertex.x - 6} y={vertex.y} width="4" height="4" fill="#fef08a" />
                  <rect x={vertex.x + 3} y={vertex.y} width="4" height="4" fill="#fef08a" />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
