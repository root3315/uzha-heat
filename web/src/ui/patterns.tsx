import { createContext, useCallback, useContext, type ReactNode } from 'react';

/**
 * Causes are drawn as cartographic hatching, never as colour: colour is reserved for temperature.
 * One vocabulary serves the profile ribbon, the panel bar, the map and the report.
 */

interface Mark {
  d: string;
  fill?: boolean;
  width?: number;
}

interface PatternSpec {
  /** Tile size, px, at full density. */
  size: number;
  marks(s: number): Mark[];
}

const SPECS: Record<string, PatternSpec> = {
  // мало зелени: sparse open circles
  ndvi: { size: 9, marks: (s) => [{ d: circle(s / 2, s / 2, s * 0.17), width: 0.9 }] },
  // нет деревьев: small open chevrons, the survey mark for missing canopy
  tree: { size: 10, marks: (s) => [{ d: `M${s * 0.34},${s * 0.62} L${s / 2},${s * 0.36} L${s * 0.66},${s * 0.62}`, width: 0.9 }] },
  // застройка: diagonal hatch at 45°
  built: {
    size: 6,
    marks: (s) => [{ d: `M0,${s} L${s},0 M${-s / 2},${s / 2} L${s / 2},${-s / 2} M${s / 2},${s * 1.5} L${s * 1.5},${s / 2}`, width: 0.8 }],
  },
  // открытый грунт: stipple
  bare: {
    size: 7,
    marks: (s) => [
      { d: circle(s * 0.25, s * 0.3, 0.7), fill: true },
      { d: circle(s * 0.72, s * 0.75, 0.7), fill: true },
    ],
  },
  // тёмные покрытия: dense cross-hatch
  albedo: { size: 4, marks: (s) => [{ d: `M0,0 L${s},${s} M0,${s} L${s},0`, width: 0.55 }] },
  // дороги: double horizontal lines
  roads: { size: 8, marks: (s) => [{ d: `M0,${s * 0.38} H${s} M0,${s * 0.62} H${s}`, width: 0.7 }] },
  // здания: small open squares
  buildings: { size: 8, marks: (s) => [{ d: `M${s * 0.3},${s * 0.3} h${s * 0.4} v${s * 0.4} h${-s * 0.4} Z`, width: 0.8 }] },
  // далеко от воды: wavy line
  water_dist: { size: 10, marks: (s) => [{ d: `M0,${s / 2} Q${s / 4},${s / 2 - 2.2} ${s / 2},${s / 2} T${s},${s / 2}`, width: 0.8 }] },
  // высота: short vertical ticks
  elevation: { size: 7, marks: (s) => [{ d: `M${s / 2},${s * 0.28} V${s * 0.72}`, width: 0.9 }] },
};

/** Keys outside the fixed vocabulary get small crosses. */
const FALLBACK: PatternSpec = { size: 8, marks: (s) => [{ d: `M${s / 2 - 1.4},${s / 2} h2.8 M${s / 2},${s / 2 - 1.4} v2.8`, width: 0.8 }] };

/** Cooling causes use the same marks, further apart. */
const COOL_SPREAD = 1.6;

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
}

export type Direction = 'heats' | 'cools';

export const directionOf = (value: number): Direction => (value >= 0 ? 'heats' : 'cools');

export function patternTile(key: string, direction: Direction): { size: number; marks: Mark[] } {
  const spec = SPECS[key] ?? FALLBACK;
  const size = direction === 'heats' ? spec.size : Math.round(spec.size * COOL_SPREAD);
  return { size, marks: spec.marks(size) };
}

export const patternId = (key: string, direction: Direction, scope = ''): string => `${scope}hatch-${key}-${direction}`;

const PATTERN_KEYS = [...Object.keys(SPECS)];

/**
 * Which set of pattern definitions the fills below point at. The report brings its own set,
 * so its hatches still print when the page under it is hidden.
 */
const PatternScope = createContext('');

export function PatternScopeProvider({ scope, children }: { scope: string; children: ReactNode }) {
  return (
    <PatternScope.Provider value={scope}>
      <PatternDefs scope={scope} />
      {children}
    </PatternScope.Provider>
  );
}

/** `fill` for a cause's hatch, as url(#…) to the nearest set of definitions. */
export function usePatternFill(): (key: string, direction: Direction) => string {
  const scope = useContext(PatternScope);
  return useCallback((key, direction) => `url(#${patternId(key, direction, scope)})`, [scope]);
}

/** One hidden SVG with every pattern, so any inline SVG in the document can use url(#hatch-…). */
export function PatternDefs({ extraKeys = [], scope = '' }: { extraKeys?: readonly string[]; scope?: string }) {
  const keys = [...new Set([...PATTERN_KEYS, ...extraKeys])];
  return (
    <svg className="pattern-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        {keys.flatMap((key) =>
          (['heats', 'cools'] as const).map((direction) => {
            const { size, marks } = patternTile(key, direction);
            const ink = direction === 'heats' ? 'var(--hatch-heats)' : 'var(--hatch-cools)';
            return (
              <pattern key={patternId(key, direction)} id={patternId(key, direction, scope)} width={size} height={size} patternUnits="userSpaceOnUse">
                {marks.map((mark) => (
                  <path
                    key={mark.d}
                    d={mark.d}
                    style={mark.fill ? { fill: ink } : { fill: 'none', stroke: ink, strokeWidth: mark.width ?? 0.8 }}
                  />
                ))}
              </pattern>
            );
          }),
        )}
      </defs>
    </svg>
  );
}

/** The same tile drawn on a canvas, transparent between the marks, for the map. */
export function patternImage(key: string, direction: Direction, ink: string, pixelRatio: number): ImageData | null {
  const { size, marks } = patternTile(key, direction);
  const canvas = document.createElement('canvas');
  canvas.width = size * pixelRatio;
  canvas.height = size * pixelRatio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  for (const mark of marks) {
    const path = new Path2D(mark.d);
    if (mark.fill) ctx.fill(path);
    else {
      ctx.lineWidth = (mark.width ?? 0.8) * 1.15;
      ctx.stroke(path);
    }
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
