import React from 'react';
import { ResourceType } from '../shared/types';

export function ResourcePixelIcon({
  type,
  size = 20,
}: {
  type: ResourceType;
  size?: number;
}) {
  switch (type) {
    case 'wood':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="6" y="10" width="4" height="5" fill="#7c3f1d" />
          <rect x="7" y="11" width="2" height="4" fill="#9a5228" />
          <rect x="3" y="6" width="10" height="4" fill="#15803d" />
          <rect x="4" y="3" width="8" height="4" fill="#22c55e" />
          <rect x="6" y="1" width="4" height="3" fill="#4ade80" />
          <rect x="3" y="9" width="10" height="1" fill="#14532d" />
        </svg>
      );
    case 'brick':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="2" y="4" width="12" height="9" fill="#991b1b" />
          <rect x="2" y="4" width="5" height="3" fill="#dc2626" />
          <rect x="8" y="4" width="6" height="3" fill="#ef4444" />
          <rect x="2" y="8" width="8" height="2" fill="#ef4444" />
          <rect x="11" y="8" width="3" height="2" fill="#dc2626" />
          <rect x="2" y="11" width="5" height="2" fill="#dc2626" />
          <rect x="8" y="11" width="6" height="2" fill="#b91c1c" />
          <rect x="2" y="7" width="12" height="1" fill="#fca5a5" opacity="0.4" />
        </svg>
      );
    case 'sheep':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="4" y="4" width="8" height="7" fill="#f8fafc" />
          <rect x="3" y="5" width="10" height="5" fill="#f1f5f9" />
          <rect x="5" y="3" width="6" height="2" fill="#ffffff" />
          <rect x="10" y="6" width="4" height="4" fill="#334155" />
          <rect x="12" y="7" width="1" height="1" fill="#f8fafc" />
          <rect x="5" y="11" width="2" height="3" fill="#334155" />
          <rect x="9" y="11" width="2" height="3" fill="#334155" />
        </svg>
      );
    case 'wheat':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="7" y="4" width="2" height="11" fill="#ca8a04" />
          <rect x="5" y="3" width="2" height="3" fill="#facc15" />
          <rect x="9" y="3" width="2" height="3" fill="#eab308" />
          <rect x="4" y="7" width="3" height="2" fill="#fde047" />
          <rect x="9" y="7" width="3" height="2" fill="#facc15" />
          <rect x="5" y="10" width="2" height="2" fill="#eab308" />
          <rect x="9" y="10" width="2" height="2" fill="#ca8a04" />
        </svg>
      );
    case 'ore':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
          <rect x="3" y="6" width="10" height="7" fill="#475569" />
          <rect x="5" y="3" width="6" height="4" fill="#64748b" />
          <rect x="2" y="9" width="12" height="4" fill="#334155" />
          <rect x="6" y="5" width="2" height="2" fill="#94a3b8" />
          <rect x="9" y="8" width="2" height="2" fill="#cbd5e1" />
          <rect x="5" y="10" width="2" height="2" fill="#60a5fa" />
        </svg>
      );
  }
}

export function PixelDiceFace({ value, size = 34 }: { value: number; size?: number }) {
  const pips: Record<number, Array<[number, number]>> = {
    1: [[7, 7]],
    2: [[4, 4], [10, 10]],
    3: [[4, 4], [7, 7], [10, 10]],
    4: [[4, 4], [10, 4], [4, 10], [10, 10]],
    5: [[4, 4], [10, 4], [7, 7], [4, 10], [10, 10]],
    6: [[4, 3], [10, 3], [4, 7], [10, 7], [4, 11], [10, 11]],
  };
  const dots = pips[value] ?? pips[1];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-label={`주사위 ${value}`}>
      <rect x="1" y="1" width="14" height="14" fill="#f5ead8" />
      <rect x="0" y="1" width="1" height="14" fill="#0d0806" />
      <rect x="15" y="1" width="1" height="14" fill="#0d0806" />
      <rect x="1" y="0" width="14" height="1" fill="#0d0806" />
      <rect x="1" y="15" width="14" height="1" fill="#0d0806" />
      <rect x="2" y="13" width="12" height="2" fill="#d6c3a5" />
      {dots.map(([x, y], idx) => (
        <rect
          key={idx}
          x={x}
          y={y}
          width="2"
          height="2"
          fill={value === 1 ? '#dc2626' : '#1a120e'}
        />
      ))}
    </svg>
  );
}

export function PixelEmblemLogo() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true">
      {/* Hex base */}
      <polygon points="12,1 22,6 22,18 12,23 2,18 2,6" fill="#1e3a5f" stroke="#eab308" strokeWidth="1.5" />
      {/* Mini island */}
      <polygon points="12,5 18,8 18,16 12,19 6,16 6,8" fill="#15803d" />
      {/* Pixel house */}
      <rect x="9" y="11" width="6" height="5" fill="#f5ead8" />
      <polygon points="12,7 16,11 8,11" fill="#ef4444" />
      <rect x="11" y="13" width="2" height="3" fill="#7c3f1d" />
    </svg>
  );
}
