import { contours } from 'd3-contour';
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon, Position } from 'geojson';
import type { Field } from './field';
import { slotToLonLat } from './grid';

/** Stepped temperature classes: thresholds[k − 1] is the floor of class k; class 0 has no floor. */
export interface IsothermLevels {
  thresholds: number[];
  /** Class holding the city mean, drawn as quiet as the ground. */
  neutral: number;
  /** Isotherms drawn a little heavier: the top of the neutral class and every second step above it. */
  major: number[];
}

export const CLASS_COUNT = 7;
export const NEUTRAL_CLASS = 2;

/** Classes of `step` degrees on even values, the neutral one around the city mean. */
export function isothermLevels(mean: number, step = 2, classes = CLASS_COUNT, neutral = NEUTRAL_CLASS): IsothermLevels {
  const neutralFloor = Math.floor(mean / step) * step;
  const thresholds = Array.from({ length: classes - 1 }, (_, k) => neutralFloor + (k + 1 - neutral) * step);
  const majorBase = neutralFloor + step;
  const major = thresholds.filter((t) => t >= majorBase && Math.round((t - majorBase) / step) % 2 === 0);
  return { thresholds, neutral, major };
}

export function classOf(levels: IsothermLevels, t: number): number {
  let k = 0;
  levels.thresholds.forEach((floor, i) => {
    if (t >= floor) k = i + 1;
  });
  return k;
}

/** Share of cells (that is, of the city's area) in each class. */
export function classShares(levels: IsothermLevels, lst: readonly number[]): number[] {
  const shares = new Array<number>(levels.thresholds.length + 1).fill(0);
  for (const t of lst) shares[classOf(levels, t)] = (shares[classOf(levels, t)] ?? 0) + 1;
  return shares.map((count) => (lst.length ? count / lst.length : 0));
}

export interface BandProperties {
  k: number;
}

export interface IsolineProperties {
  t: number;
  major: boolean;
}

export interface LabelAnchor {
  t: number;
  major: boolean;
  /** Where the label sits, and a point a little further along the line to orient it. */
  at: Position;
  toward: Position;
}

export interface IsothermGeometry {
  /** One stacked MultiPolygon per class: class 0 is the whole data coverage, class k is everything at or above its floor. */
  bands: FeatureCollection<MultiPolygon, BandProperties>;
  lines: FeatureCollection<LineString, IsolineProperties>;
  /** Candidate label positions along the longer isolines, evenly spaced along the line. */
  anchors: LabelAnchor[];
  coverage: MultiPolygon;
}

export interface IsothermOptions {
  labelSpacingM?: number;
  minLabelledRingM?: number;
}

/** Rings shorter than this many fine pixels are specks; their isolines are noise. */
const MIN_LINE_POINTS = 12;
/** Points ahead used to orient a label along its line. */
const LABEL_LOOKAHEAD = 3;

type Ring = Position[];

/** d3-contour puts fine pixel u at coordinate u + 0.5; this maps that straight to slot space. */
function contourToSlot(field: Field): (point: Position) => Position {
  return ([u = 0, v = 0]) => [u / field.factor - 0.5, v / field.factor - 0.5];
}

function ringLengthM(ring: Ring, cellSizeM: number): number[] {
  const walked = [0];
  for (let j = 1; j < ring.length; j++) {
    const [ax = 0, ay = 0] = ring[j - 1] ?? [];
    const [bx = 0, by = 0] = ring[j] ?? [];
    walked.push((walked[j - 1] ?? 0) + Math.hypot(bx - ax, by - ay) * cellSizeM);
  }
  return walked;
}

/** Indices along a ring (in slot space) where labels go: one per `spacingM`, starting half a spacing in. */
export function anchorIndices(ring: Ring, cellSizeM: number, spacingM: number, minRingM: number): number[] {
  const walked = ringLengthM(ring, cellSizeM);
  const length = walked[walked.length - 1] ?? 0;
  if (length < minRingM) return [];
  const indices: number[] = [];
  let next = Math.min(spacingM, length) / 2;
  walked.forEach((distance, j) => {
    if (distance + 1e-6 < next) return;
    indices.push(j);
    next += spacingM;
  });
  return indices;
}

export function isothermGeometry(field: Field, levels: IsothermLevels, options: IsothermOptions = {}): IsothermGeometry {
  const { labelSpacingM = 2500, minLabelledRingM = 1200 } = options;
  const toSlot = contourToSlot(field);
  const toLonLat = (slot: Position): Position => slotToLonLat(field.grid, slot[0] ?? 0, slot[1] ?? 0);
  const generator = contours().size([field.fx, field.fy]);

  const [covered] = generator.thresholds([0.5])(Array.from(field.coverage));
  const coverage: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: (covered?.coordinates ?? []).map((polygon) => polygon.map((ring) => ring.map((p) => toLonLat(toSlot(p))))),
  };

  const bands: Feature<MultiPolygon, BandProperties>[] = [{ type: 'Feature', properties: { k: 0 }, geometry: coverage }];
  const lines: Feature<LineString, IsolineProperties>[] = [];
  const anchors: LabelAnchor[] = [];
  generator.thresholds(levels.thresholds)(Array.from(field.values)).forEach((band, i) => {
    const t = levels.thresholds[i] ?? band.value;
    const major = levels.major.includes(t);
    const slotPolygons = band.coordinates.map((polygon) => polygon.map((ring) => ring.map(toSlot)));
    const coordinates = slotPolygons.map((polygon) => polygon.map((ring) => ring.map(toLonLat)));
    bands.push({ type: 'Feature', properties: { k: i + 1 }, geometry: { type: 'MultiPolygon', coordinates } });

    const rings = coordinates.flat();
    slotPolygons.flat().forEach((slotRing, r) => {
      if (slotRing.length < MIN_LINE_POINTS) return;
      const ring = rings[r] ?? [];
      lines.push({ type: 'Feature', properties: { t, major }, geometry: { type: 'LineString', coordinates: ring } });
      for (const j of anchorIndices(slotRing, field.grid.cellSizeM, labelSpacingM, minLabelledRingM)) {
        const at = ring[j];
        const toward = ring[Math.min(ring.length - 1, j + LABEL_LOOKAHEAD)];
        if (at && toward) anchors.push({ t, major, at, toward });
      }
    });
  });

  return {
    bands: { type: 'FeatureCollection', features: bands },
    lines: { type: 'FeatureCollection', features: lines },
    anchors,
    coverage,
  };
}

const WORLD: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/** Everything outside an area, for painting the ground over data that must not show. */
export function outsideOf(area: Polygon | MultiPolygon): FeatureCollection<Polygon> {
  const polygons = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  const outers = polygons.map((polygon) => polygon[0]).filter((ring): ring is Position[] => ring !== undefined);
  const holes = polygons.flatMap((polygon) => polygon.slice(1));
  const features: Feature<Polygon>[] = [
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD, ...outers] } },
    ...holes.map((hole): Feature<Polygon> => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [hole] } })),
  ];
  return { type: 'FeatureCollection', features };
}
