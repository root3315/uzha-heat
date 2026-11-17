import type { FacilityType } from '../data/contract';
import type { Sink } from '../domain/energy';

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
  // нет деревьев: a round crown with the trunk and one bough showing through it, on the ground
  tree: [{ circle: [12, 9, 6] }, { path: 'M12 20.5V9.5M12 13l2.5-2.5M8 20.5h8' }],
  // застройка: a block of houses sharing walls, with windows, so it never reads as a bar chart
  built: [
    { path: 'M3.5 20.5V10h5.5v10.5M9 20.5V5h6.5v15.5M15.5 20.5V12.5h5v8M2 20.5h20' },
    { path: 'M5.6 13h1.3M5.6 16.5h1.3M11.5 8h2.5M11.5 11.5h2.5M11.5 15h2.5M17.4 15.5h1.3' },
  ],
  // здания: one building with windows
  buildings: [{ path: 'M6 20.5V3.5h12v17M3.5 20.5h17M9.5 7.5h1M13.5 7.5h1M9.5 11h1M13.5 11h1M9.5 14.5h1M13.5 14.5h1M11 20.5v-3h2v3' }],
  // высота зданий: one tower and its dimension line, as on a drawing
  height: [
    { path: 'M6.5 20.5V3.5h7v17M3 20.5h14.5M10 7h0M10 10.5h0M10 14h0' },
    { path: 'M19.5 3.5v17M18 3.5h3M18 20.5h3' },
  ],
  // объём застройки: a building mass in isometric, floors drawn on one side only
  volume: [
    { path: 'M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z' },
    { path: 'M4 7.5 12 12l8-4.5M12 12v9M4 10.5l8 4.5M4 13.5l8 4.5' },
  ],
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
    { path: 'M12 1.5v1.5M5 7.5h2M17 7.5h2M7 2.6l1.2 1.2M17 2.6l-1.2 1.2M2.5 14h19M8 21l2-4M12 21.5v-4.5M16 21l-2-4' },
  ],
  // далеко от воды: a drop
  water_dist: [{ path: 'M12 3.5c3.6 4.4 6 8 6 11a6 6 0 0 1-12 0c0-3 2.4-6.6 6-11Z' }, { path: 'M9.2 14.8a2.8 2.8 0 0 0 2.8 2.8' }],
  // рельеф: two peaks
  elevation: [{ path: 'M2 20 9 7.5l4.4 7.4L16 11l6 9H2Z' }, { path: 'm7 11 2 1.5 2-1.4' }],
};

/** Schools, kindergartens and clinics, in the same hand: they mark who is in the heat, not why it is hot. */
export const FACILITY_SHAPES: Record<FacilityType, Shape[]> = {
  // школа: a schoolhouse with its bell tower
  school: [{ path: 'M4 20.5V11l8-4.5 8 4.5v9.5M2.5 20.5h19M10 20.5v-4.5h4v4.5M12 6.5V2.5l3.5 1.2L12 5' }, { circle: [12, 11.8, 1.6] }],
  // детский сад: a grown-up and a child holding hands
  kindergarten: [
    { circle: [8, 4.5, 2] },
    { path: 'M8 7.5v7M8 14.5l-2 6M8 14.5l2 6M8 9.5l-2.5 4M8 9.5l4.5 4.5 3.5-1.5' },
    { circle: [17, 10, 1.7] },
    { path: 'M17 12.5v4M17 16.5l-1.5 4M17 16.5l1.5 4' },
  ],
  // поликлиника: a cross in a frame
  clinic: [{ path: 'M4.5 4.5h15v15h-15Z' }, { path: 'M12 8v8M8 12h8' }],
  // больница: a building with a cross on its front
  hospital: [{ path: 'M5 20.5V5.5h14v15M3 20.5h18M10.5 20.5v-3.5h3v3.5' }, { path: 'M12 8v5M9.5 10.5h5' }],
};

/** Where the sun's energy goes, in the same hand: they name a flux, never a cause. */
export const SINK_SHAPES: Record<Sink, Shape[]> = {
  // испарение: a drop with vapour rising from it
  le: [{ path: 'M12 10.5c2.4 3 4 5.3 4 7.3a4 4 0 0 1-8 0c0-2 1.6-4.3 4-7.3Z' }, { path: 'M7 7.5c-1-1.2 1-2.3 0-3.5M12 6c-1-1.2 1-2.3 0-3.5M17 7.5c-1-1.2 1-2.3 0-3.5' }],
  // нагрев воздуха: heat shimmer rising off a hot ground line
  h: [{ path: 'M2.5 20.5h19M7 16.5c-1.5-2 1.5-3.5 0-5.5s1.5-3.5 0-5.5M12 16.5c-1.5-2 1.5-3.5 0-5.5s1.5-3.5 0-5.5M17 16.5c-1.5-2 1.5-3.5 0-5.5s1.5-3.5 0-5.5' }],
  // в грунт: an arrow going down through the ground line into the layers
  g: [{ path: 'M2.5 9.5h19M12 2.5v13M9 12.5l3 3 3-3M4 14.5h3M17 14.5h3M5 18.5h14M8 21.5h8' }],
};

export function SinkIcon({ sink, size = 18, className = 'cause-icon' }: { sink: Sink; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <Glyph shapes={SINK_SHAPES[sink]} />
    </svg>
  );
}

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
