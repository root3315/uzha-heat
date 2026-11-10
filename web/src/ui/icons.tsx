import type { FacilityType } from '../data/contract';

/**
 * One small icon per cause, drawn on a 24 px grid with a 1.5 px stroke in the current text colour.
 * They sit next to the hatch, never instead of it: the hatch says where, the icon says what.
 */

export type Shape =
  | { path: string }
  | { circle: [cx: number, cy: number, r: number]; dot?: boolean };

const SHAPES: Record<string, Shape[]> = {
  // мало зелени: a leaf with its vein
  ndvi: [{ path: 'M19 4.5C11.5 4.5 6 8.5 6 14.5c0 1.6.4 3 1.1 4.2C13.6 18.7 19 14 19 4.5Z' }, { path: 'M4.5 20.5c2.6-4.6 6-8.4 10.5-11.5' }],
  // нет деревьев: a round crown on a trunk
  tree: [{ path: 'M12 15.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z' }, { path: 'M12 15.5V21M8.5 21h7M12 12.5l-2-2M12 13.5l2.2-2.2' }],
  // застройка: blocks of different heights on one ground line
  built: [{ path: 'M3.5 20.5V11h5.5v9.5M9 20.5V5.5h6v15M15 20.5v-7.5h5.5v7.5M2 20.5h20' }],
  // здания: one building with windows
  buildings: [{ path: 'M6 20.5V3.5h12v17M3.5 20.5h17M9.5 7.5h1M13.5 7.5h1M9.5 11h1M13.5 11h1M9.5 14.5h1M13.5 14.5h1M11 20.5v-3h2v3' }],
  // дороги: a road going away, with its centre line
  roads: [{ path: 'M8.5 3.5 4 20.5M15.5 3.5l4.5 17M12 4v2.5M12 10v3M12 17v3.5' }],
  // голая земля: the ground line and loose soil under it
  bare: [
    { path: 'M2.5 8.5h19' },
    { circle: [6, 12.5, 0.9], dot: true },
    { circle: [12, 11.5, 0.9], dot: true },
    { circle: [18, 13, 0.9], dot: true },
    { circle: [8.5, 16.5, 0.9], dot: true },
    { circle: [15, 17, 0.9], dot: true },
    { circle: [5, 20, 0.9], dot: true },
    { circle: [11.5, 20.5, 0.9], dot: true },
    { circle: [19, 19.5, 0.9], dot: true },
  ],
  // яркий грунт: the sun over the ground, and light bouncing back off it
  albedo: [
    { circle: [12, 7.5, 3] },
    { path: 'M12 2v1M5.5 7.5h1.2M17.3 7.5h1.2M7.4 3l.8.8M16.6 3l-.8.8M2.5 14h19M8 20.5l2-3.5M12 21v-4M16 20.5l-2-3.5' },
  ],
  // далеко от воды: a drop
  water_dist: [{ path: 'M12 3.5c3.6 4.4 6 8 6 11a6 6 0 0 1-12 0c0-3 2.4-6.6 6-11Z' }, { path: 'M9.2 14.8a2.8 2.8 0 0 0 2.8 2.8' }],
  // рельеф: two peaks
  elevation: [{ path: 'M2 20 9 7.5l4.4 7.4L16 11l6 9H2Z' }, { path: 'm7 11 2 1.5 2-1.4' }],
};

/** Schools, kindergartens and clinics, in the same hand: they mark who is in the heat, not why it is hot. */
export const FACILITY_SHAPES: Record<FacilityType, Shape[]> = {
  // школа: a schoolhouse with its bell tower
  school: [{ path: 'M4 20.5V11l8-4.5 8 4.5v9.5M2.5 20.5h19M10 20.5v-4.5h4v4.5M12 6.5V3.5M12 3.5h3v2h-3' }, { circle: [12, 11.8, 1.6] }],
  // детский сад: a child with arms open
  kindergarten: [{ circle: [12, 5.5, 2.3] }, { path: 'M12 8.5v6.5M6.5 10.5l5.5 2 5.5-2M9 21l3-6 3 6' }],
  // поликлиника: a cross in a frame
  clinic: [{ path: 'M4.5 4.5h15v15h-15Z' }, { path: 'M12 8v8M8 12h8' }],
  // больница: a building with a cross on its front
  hospital: [{ path: 'M5 20.5V5.5h14v15M3 20.5h18M10.5 20.5v-3.5h3v3.5' }, { path: 'M12 8v5M9.5 10.5h5' }],
};

/** Keys outside the vocabulary: a plain ring, so the row still lines up. */
const FALLBACK: Shape[] = [{ circle: [12, 12, 4] }];

export const hasIcon = (key: string): boolean => key in SHAPES;

function Glyph({ shapes }: { shapes: Shape[] }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {shapes.map((shape, i) =>
        'path' in shape ? (
          <path key={i} d={shape.path} />
        ) : (
          <circle key={i} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} fill={shape.dot ? 'currentColor' : 'none'} stroke={shape.dot ? 'none' : undefined} />
        ),
      )}
    </g>
  );
}

/** The icon's marks as SVG children, for placing inside another SVG (the profile ribbon). */
export function CauseGlyph({ cause }: { cause: string }) {
  return <Glyph shapes={SHAPES[cause] ?? FALLBACK} />;
}

export function CauseIcon({ cause, size = 20, className = 'cause-icon' }: { cause: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <CauseGlyph cause={cause} />
    </svg>
  );
}

export function FacilityIcon({ type, size = 18, className = 'cause-icon' }: { type: FacilityType; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <Glyph shapes={FACILITY_SHAPES[type]} />
    </svg>
  );
}
