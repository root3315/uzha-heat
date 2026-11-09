import type { CityDetail } from '../data/contract';
import { causeWords } from './causes';
import { dominantHeatingFactor } from './places';
import { mean, meanAt } from './stats';

/** What the hottest tenth of the city is made of, compared with the whole map. */
export type HotTenthKind = 'open' | 'dense-bare' | 'dense' | 'bare' | 'mixed';

export interface Share {
  /** Mean share in the hottest tenth, %. */
  hot: number;
  /** Mean share over all cells, %. */
  city: number;
}

export interface HotTenthPattern {
  kind: HotTenthKind;
  /** Part of the hottest tenth that lies outside the city outline, 0–1. */
  outsideShare: number;
  built: Share | null;
  bare: Share | null;
}

/** A difference in built-up share this large, in percentage points, is "dense" or "sparse". */
const BUILT_PP = 10;
/** Bare ground is rare everywhere, so a smaller gap already stands out. */
const BARE_PP = 4;

function share(detail: CityDetail, key: string, members: readonly number[]): Share | null {
  const values = detail.cells.values[key];
  if (!values || members.length === 0) return null;
  return { hot: meanAt(values, members), city: mean(values) };
}

const gap = (s: Share | null) => (s ? s.hot - s.city : 0);

/**
 * The land cover of the hottest tenth, read from the data rather than assumed:
 * open, barely built land (often at the edge), dense building, bare ground, or dense building with bare ground.
 */
export function hotTenthPattern(detail: CityDetail, members: readonly number[], inside: readonly boolean[]): HotTenthPattern {
  const outsideShare = members.length ? members.filter((i) => !inside[i]).length / members.length : 0;
  const built = share(detail, 'built', members);
  const bare = share(detail, 'bare', members);
  const builtGap = gap(built);
  const bareGap = gap(bare);
  let kind: HotTenthKind = 'mixed';
  if (builtGap <= -BUILT_PP) kind = 'open';
  else if (builtGap >= BUILT_PP && bareGap >= BARE_PP) kind = 'dense-bare';
  else if (builtGap >= BUILT_PP) kind = 'dense';
  else if (bareGap >= BARE_PP) kind = 'bare';
  return { kind, outsideShare, built, bare };
}

export interface CauseShare {
  key: string;
  /** Share of the hottest tenth where this factor heats most, 0–1. */
  share: number;
}

/** How often each factor is the one that heats a cell most, over `members`, most frequent first. */
export function dominantShares(detail: CityDetail, members: readonly number[]): CauseShare[] {
  const keys = detail.features.map((f) => f.key);
  const wins = new Map<string, number>();
  for (const i of members) {
    const best = dominantHeatingFactor(keys, (key) => detail.cells.shap[key]?.[i] ?? 0);
    if (best) wins.set(best, (wins.get(best) ?? 0) + 1);
  }
  return [...wins.entries()].map(([key, n]) => ({ key, share: n / (members.length || 1) })).sort((a, b) => b.share - a.share);
}

/** A second cause has to lead in at least this share of the hottest tenth to be worth naming. */
const MIN_SECOND_SHARE = 0.05;

/**
 * The runner-up cause, only when the data agrees with the reading: a factor that "heats" while it sits on the
 * harmless side of the city mean (sparse building that heats bare outskirts) is the model picking up something else.
 */
export function secondCause(detail: CityDetail, members: readonly number[], shares: readonly CauseShare[]): CauseShare | null {
  for (const candidate of shares.slice(1)) {
    if (candidate.share < MIN_SECOND_SHARE) return null;
    const feature = detail.features.find((f) => f.key === candidate.key);
    const better = feature ? causeWords(feature).better : null;
    const values = detail.cells.values[candidate.key];
    if (!better || !values) continue;
    const hot = meanAt(values, members);
    const city = mean(values);
    if (better === 'up' ? hot < city : hot > city) return candidate;
  }
  return null;
}
