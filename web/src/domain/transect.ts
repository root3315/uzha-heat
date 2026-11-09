import type { Metres } from './utm';

export type LonLat = [number, number];
export type Transect = [LonLat, LonLat];

/** What the transect needs to know about the city, injected so the sampling stays testable. */
export interface TransectSource {
  toMetres(point: LonLat): Metres;
  fromMetres(point: Metres): LonLat;
  /** Data cell under the point, or −1. */
  cellAt(point: LonLat): number;
  /** Inside the city outline (always true when there is no outline). */
  inside(point: LonLat): boolean;
  /** Smoothed surface temperature, the same surface the isotherms are drawn from. */
  temperatureAt(point: LonLat): number;
  /** °C each factor adds to the cell. */
  contributionsOf(cell: number): Record<string, number>;
}

export interface Cause {
  key: string;
  /** Contribution, °C; positive heats. */
  value: number;
}

export interface Sample {
  /** Distance from А, metres. */
  d: number;
  point: LonLat;
  cell: number;
  inside: boolean;
  t: number;
  /** °C each factor adds here; null outside the data or the city. */
  contributions: Record<string, number> | null;
  cause: Cause | null;
}

export interface Segment {
  key: string;
  heats: boolean;
  d0: number;
  d1: number;
}

export interface Profile {
  length: number;
  samples: Sample[];
  segments: Segment[];
}

export interface ProfileOptions {
  stepM?: number;
  /** Samples on each side used to take the local majority cause. */
  smoothWindow?: number;
  /** Stretches shorter than this fold into their neighbour. */
  minSegmentM?: number;
}

/** The factor that moves the temperature most, either way. */
export function dominantCause(contributions: Record<string, number>): Cause | null {
  let best: Cause | null = null;
  for (const [key, value] of Object.entries(contributions)) {
    if (!best || Math.abs(value) > Math.abs(best.value)) best = { key, value };
  }
  return best;
}

const tagOf = (cause: Cause | null): string | null => (cause ? `${cause.key}:${cause.value >= 0 ? 'heats' : 'cools'}` : null);

/** Local majority of tags in a window, so a cause flipping every 200 m reads as one stretch. */
export function smoothTags(tags: readonly (string | null)[], window: number): (string | null)[] {
  return tags.map((tag, i) => {
    if (tag === null) return null;
    const counts = new Map<string, number>();
    for (let j = Math.max(0, i - window); j <= Math.min(tags.length - 1, i + window); j++) {
      const other = tags[j];
      if (other) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
    let best = tag;
    let bestCount = 0;
    for (const [candidate, count] of counts) {
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    return best;
  });
}

interface TaggedRun {
  tag: string | null;
  d0: number;
  d1: number;
}

function runsOf(distances: readonly number[], tags: readonly (string | null)[]): TaggedRun[] {
  const runs: TaggedRun[] = [];
  distances.forEach((d, i) => {
    const tag = tags[i] ?? null;
    const last = runs[runs.length - 1];
    if (last) last.d1 = d;
    if (last && last.tag === tag) return;
    runs.push({ tag, d0: d, d1: d });
  });
  return runs;
}

/** Contiguous stretches of one cause; slivers shorter than `minLengthM` join the stretch before them. */
export function mergeSegments(distances: readonly number[], tags: readonly (string | null)[], minLengthM: number): Segment[] {
  const merged: TaggedRun[] = [];
  for (const run of runsOf(distances, tags)) {
    const prev = merged[merged.length - 1];
    const sliver = run.d1 - run.d0 < minLengthM;
    if (prev && run.tag && prev.tag && (sliver || prev.tag === run.tag)) {
      prev.d1 = run.d1;
      continue;
    }
    merged.push({ ...run });
  }
  const first = merged[0];
  const second = merged[1];
  if (first?.tag && second?.tag && first.d1 - first.d0 < minLengthM) {
    second.d0 = first.d0;
    merged.shift();
  }
  return merged.flatMap((run) => {
    if (!run.tag) return [];
    const [key = '', direction] = run.tag.split(':');
    return [{ key, heats: direction === 'heats', d0: run.d0, d1: run.d1 }];
  });
}

export function transectLength(source: TransectSource, [a, b]: Transect): number {
  const [ax, ay] = source.toMetres(a);
  const [bx, by] = source.toMetres(b);
  return Math.hypot(bx - ax, by - ay);
}

export function sampleTransect(source: TransectSource, [a, b]: Transect, options: ProfileOptions = {}): Profile {
  const { stepM = 50, smoothWindow = 5, minSegmentM = 350 } = options;
  const [ax, ay] = source.toMetres(a);
  const [bx, by] = source.toMetres(b);
  const length = Math.hypot(bx - ax, by - ay);
  const count = Math.max(2, Math.round(length / stepM) + 1);
  const samples: Sample[] = [];
  for (let s = 0; s < count; s++) {
    const f = s / (count - 1);
    const point = source.fromMetres([ax + (bx - ax) * f, ay + (by - ay) * f]);
    const cell = source.cellAt(point);
    const inside = cell >= 0 && source.inside(point);
    const contributions = inside ? source.contributionsOf(cell) : null;
    samples.push({
      d: f * length,
      point,
      cell,
      inside,
      t: source.temperatureAt(point),
      contributions,
      cause: contributions ? dominantCause(contributions) : null,
    });
  }
  const tags = smoothTags(samples.map((sample) => tagOf(sample.cause)), smoothWindow);
  const segments = mergeSegments(
    samples.map((sample) => sample.d),
    tags,
    minSegmentM,
  );
  return { length, samples, segments };
}

export function insideSamples(profile: Profile): Sample[] {
  return profile.samples.filter((sample) => sample.inside);
}

/** Nearest sample to a distance along the line. */
export function sampleAt(profile: Profile, d: number): Sample | undefined {
  const { samples, length } = profile;
  if (samples.length === 0) return undefined;
  const i = Math.round((d / (length || 1)) * (samples.length - 1));
  return samples[Math.max(0, Math.min(samples.length - 1, i))];
}

export interface DefaultTransectOptions {
  halfLengthsM?: number[];
  angleStepDeg?: number;
}

/**
 * A line through `center` in the direction with the biggest swing from cool to hot,
 * as long as both ends stay in the city: a section that is never flat.
 */
export function defaultTransect(source: TransectSource, center: LonLat, options: DefaultTransectOptions = {}): Transect {
  const { halfLengthsM = [7000, 6000, 5000, 4000, 3000, 2000], angleStepDeg = 10 } = options;
  const [cx, cy] = source.toMetres(center);
  for (const half of halfLengthsM) {
    let best: { score: number; line: Transect } | null = null;
    for (let angle = 0; angle < 180; angle += angleStepDeg) {
      const rad = (angle * Math.PI) / 180;
      const a = source.fromMetres([cx - Math.cos(rad) * half, cy - Math.sin(rad) * half]);
      const b = source.fromMetres([cx + Math.cos(rad) * half, cy + Math.sin(rad) * half]);
      if (source.cellAt(a) < 0 || source.cellAt(b) < 0 || !source.inside(a) || !source.inside(b)) continue;
      const profile = sampleTransect(source, [a, b], { stepM: 100 });
      const temps = insideSamples(profile).map((sample) => sample.t);
      if (temps.length < 2) continue;
      const score = (Math.max(...temps) - Math.min(...temps)) * (temps.length / profile.samples.length);
      if (!best || score > best.score) best = { score, line: [a, b] };
    }
    if (best) return best.line;
  }
  const fallback = halfLengthsM[halfLengthsM.length - 1] ?? 1000;
  return [source.fromMetres([cx - fallback, cy]), source.fromMetres([cx + fallback, cy])];
}

/**
 * Centre of the hottest neighbourhood: the point whose surroundings within `radius`
 * (in raster pixels) are hottest on average, among points that pass `allowed`.
 */
export function hottestPatch(
  values: ArrayLike<number>,
  width: number,
  height: number,
  allowed: (u: number, v: number) => boolean,
  radius: number,
  step = Math.max(1, Math.round(radius / 5)),
): [number, number] | null {
  let best = -Infinity;
  let pick: [number, number] | null = null;
  for (let v = 0; v < height; v += step) {
    for (let u = 0; u < width; u += step) {
      if (!allowed(u, v)) continue;
      let sum = 0;
      let n = 0;
      for (let dv = -radius; dv <= radius; dv += step) {
        for (let du = -radius; du <= radius; du += step) {
          const uu = u + du;
          const vv = v + dv;
          if (uu < 0 || vv < 0 || uu >= width || vv >= height) continue;
          sum += values[vv * width + uu] ?? 0;
          n++;
        }
      }
      if (n > 0 && sum / n > best) {
        best = sum / n;
        pick = [u, v];
      }
    }
  }
  return pick;
}
