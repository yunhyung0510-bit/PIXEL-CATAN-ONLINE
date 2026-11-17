import type { BoardMode, Edge, HexTile, Port, PortKind, TerrainType, Vertex } from './types';

// Standard 19-hex axial coordinates (radius = 2), pointy-top orientation
const AXIAL_COORDS: Array<{ q: number; r: number }> = [
  // Row r = -2 (3 hexes)
  { q: 0, r: -2 },
  { q: 1, r: -2 },
  { q: 2, r: -2 },
  // Row r = -1 (4 hexes)
  { q: -1, r: -1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 2, r: -1 },
  // Row r = 0 (5 hexes)
  { q: -2, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  // Row r = 1 (4 hexes)
  { q: -2, r: 1 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
  { q: 1, r: 1 },
  // Row r = 2 (3 hexes)
  { q: -2, r: 2 },
  { q: -1, r: 2 },
  { q: 0, r: 2 },
];

const STANDARD_TERRAINS: TerrainType[] = [
  'mountains',
  'pasture',
  'forest',
  'fields',
  'hills',
  'pasture',
  'hills',
  'fields',
  'forest',
  'desert',
  'forest',
  'mountains',
  'forest',
  'mountains',
  'fields',
  'pasture',
  'hills',
  'fields',
  'pasture',
];

const STANDARD_NUMBERS: number[] = [
  10, 2, 9,
  12, 6, 4, 10,
  9, 11, 3, 8,
  8, 3, 4, 5,
  5, 6, 11,
];

const TERRAIN_POOL: TerrainType[] = [
  'forest', 'forest', 'forest', 'forest',
  'pasture', 'pasture', 'pasture', 'pasture',
  'fields', 'fields', 'fields', 'fields',
  'hills', 'hills', 'hills',
  'mountains', 'mountains', 'mountains',
  'desert',
];

const NUMBER_POOL: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

const PORT_KINDS: PortKind[] = [
  'generic',
  'wheat',
  'ore',
  'generic',
  'sheep',
  'generic',
  'generic',
  'brick',
  'wood',
];

export const HEX_SIZE = 54;
const SQRT3 = Math.sqrt(3);

export function createRng(seed?: number): () => number {
  if (seed === undefined) {
    return () => Math.random();
  }
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function shuffleArray<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * SQRT3 * (q + r / 2);
  const y = size * 1.5 * r;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function quantizeCoord(val: number): number {
  return Math.round(val * 10) / 10;
}

function makeVertexKey(x: number, y: number): string {
  // Snap within ~1px to reliably unify shared hex corners
  const qx = Math.round(x);
  const qy = Math.round(y);
  return `v_${qx}_${qy}`;
}

function makeEdgeKey(v1: string, v2: string): string {
  return v1 < v2 ? `e_${v1}__${v2}` : `e_${v2}__${v1}`;
}

function assignBalancedNumbers(terrains: TerrainType[], rng: () => number): Array<number | null> {
  // Try up to 40 shuffles to ensure 6 and 8 aren't directly adjacent
  for (let attempt = 0; attempt < 40; attempt++) {
    const nums = shuffleArray(NUMBER_POOL, rng);
    const result: Array<number | null> = [];
    let numIdx = 0;
    for (let i = 0; i < terrains.length; i++) {
      if (terrains[i] === 'desert') {
        result.push(null);
      } else {
        result.push(nums[numIdx++]);
      }
    }

    let valid = true;
    for (let i = 0; i < AXIAL_COORDS.length && valid; i++) {
      const n1 = result[i];
      if (n1 !== 6 && n1 !== 8) continue;
      for (let j = i + 1; j < AXIAL_COORDS.length; j++) {
        const n2 = result[j];
        if (n2 !== 6 && n2 !== 8) continue;
        const dq = AXIAL_COORDS[i].q - AXIAL_COORDS[j].q;
        const dr = AXIAL_COORDS[i].r - AXIAL_COORDS[j].r;
        const ds = -AXIAL_COORDS[i].q - AXIAL_COORDS[i].r - (-AXIAL_COORDS[j].q - AXIAL_COORDS[j].r);
        const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
        if (dist <= 1) {
          valid = false;
          break;
        }
      }
    }
    if (valid) return result;
  }

  // Fallback assignment
  const nums = shuffleArray(NUMBER_POOL, rng);
  let idx = 0;
  return terrains.map((t) => (t === 'desert' ? null : nums[idx++]));
}

export function generateBoard(
  mode: BoardMode,
  rng: () => number = Math.random
): {
  hexes: HexTile[];
  vertices: Record<string, Vertex>;
  edges: Record<string, Edge>;
  ports: Port[];
  robberHexId: number;
} {
  let terrains: TerrainType[];
  let numbers: Array<number | null>;

  if (mode === 'standard') {
    terrains = [...STANDARD_TERRAINS];
    let nIdx = 0;
    numbers = terrains.map((t) => (t === 'desert' ? null : STANDARD_NUMBERS[nIdx++]));
  } else {
    terrains = shuffleArray(TERRAIN_POOL, rng);
    numbers = assignBalancedNumbers(terrains, rng);
  }

  const vertices: Record<string, Vertex> = {};
  const edges: Record<string, Edge> = {};
  const hexes: HexTile[] = [];
  const edgeHexCount: Record<string, number> = {};

  // Build hexes, vertices, and edges
  for (let i = 0; i < AXIAL_COORDS.length; i++) {
    const { q, r } = AXIAL_COORDS[i];
    const center = axialToPixel(q, r, HEX_SIZE);
    const cornerIds: string[] = [];

    for (let c = 0; c < 6; c++) {
      const angleDeg = 60 * c - 30;
      const angleRad = (Math.PI / 180) * angleDeg;
      const vx = quantizeCoord(center.x + HEX_SIZE * Math.cos(angleRad));
      const vy = quantizeCoord(center.y + HEX_SIZE * Math.sin(angleRad));
      const vKey = makeVertexKey(vx, vy);

      if (!vertices[vKey]) {
        vertices[vKey] = {
          id: vKey,
          x: vx,
          y: vy,
          adjacentVertexIds: [],
          adjacentEdgeIds: [],
          adjacentHexIds: [],
          portId: null,
          ownerId: null,
          building: null,
        };
      }
      if (!vertices[vKey].adjacentHexIds.includes(i)) {
        vertices[vKey].adjacentHexIds.push(i);
      }
      cornerIds.push(vKey);
    }

    const hexEdgeIds: string[] = [];
    for (let c = 0; c < 6; c++) {
      const v1Id = cornerIds[c];
      const v2Id = cornerIds[(c + 1) % 6];
      const v1 = vertices[v1Id];
      const v2 = vertices[v2Id];
      const eKey = makeEdgeKey(v1Id, v2Id);

      if (!edges[eKey]) {
        const [a, b] = v1Id < v2Id ? [v1, v2] : [v2, v1];
        edges[eKey] = {
          id: eKey,
          v1: a.id,
          v2: b.id,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          mx: quantizeCoord((a.x + b.x) / 2),
          my: quantizeCoord((a.y + b.y) / 2),
          ownerId: null,
        };
      }

      edgeHexCount[eKey] = (edgeHexCount[eKey] || 0) + 1;

      if (!v1.adjacentVertexIds.includes(v2Id)) v1.adjacentVertexIds.push(v2Id);
      if (!v2.adjacentVertexIds.includes(v1Id)) v2.adjacentVertexIds.push(v1Id);
      if (!v1.adjacentEdgeIds.includes(eKey)) v1.adjacentEdgeIds.push(eKey);
      if (!v2.adjacentEdgeIds.includes(eKey)) v2.adjacentEdgeIds.push(eKey);
      hexEdgeIds.push(eKey);
    }

    hexes.push({
      id: i,
      q,
      r,
      x: center.x,
      y: center.y,
      terrain: terrains[i],
      numberToken: numbers[i],
      vertexIds: cornerIds,
      edgeIds: hexEdgeIds,
    });
  }

  // Order coastal edges clockwise around board center (0, 0)
  const coastalEdges = Object.values(edges)
    .filter((e) => edgeHexCount[e.id] === 1)
    .sort((a, b) => Math.atan2(a.my, a.mx) - Math.atan2(b.my, b.mx));

  // There are 30 coastal edges on a 19-hex Catan board.
  // Pick 9 evenly spaced coastal edges for the 9 ports (spacing ~3.33).
  const portKinds = mode === 'standard' ? [...PORT_KINDS] : shuffleArray(PORT_KINDS, rng);
  const ports: Port[] = [];
  const step = coastalEdges.length / 9;

  for (let p = 0; p < 9; p++) {
    const edgeIdx = Math.floor(p * step + 1) % coastalEdges.length;
    const edge = coastalEdges[edgeIdx];
    const angle = Math.atan2(edge.my, edge.mx);
    const dist = Math.hypot(edge.mx, edge.my);
    const portDist = dist + 28;
    const px = quantizeCoord(Math.cos(angle) * portDist);
    const py = quantizeCoord(Math.sin(angle) * portDist);
    const kind = portKinds[p];
    const portId = `port_${p}`;

    ports.push({
      id: portId,
      kind,
      ratio: kind === 'generic' ? 3 : 2,
      edgeId: edge.id,
      vertexIds: [edge.v1, edge.v2],
      x: px,
      y: py,
      angle,
    });

    vertices[edge.v1].portId = portId;
    vertices[edge.v2].portId = portId;
  }

  const desertHex = hexes.find((h) => h.terrain === 'desert') ?? hexes[9];

  return {
    hexes,
    vertices,
    edges,
    ports,
    robberHexId: desertHex.id,
  };
}
