import { useId, useMemo, useState, type MouseEvent, type PointerEvent } from 'react';
import { causeLabel, causeWords } from '../domain/causes';
import { classOf, type IsothermLevels } from '../domain/isotherms';
import { runsOf, sampleAt, type Profile, type Sample } from '../domain/transect';
import type { FeatureMeta } from '../data/contract';
import { MAP_TEXTS } from '../map/map.texts';
import { CauseGlyph } from './icons';
import { useFormats, useLocale } from './locale';
import { PROFILE_TEXTS } from './ui.texts';
import { usePatternFill } from './patterns';

interface ProfileChartProps {
  profile: Profile;
  levels: IsothermLevels;
  cityMean: number;
  features: readonly FeatureMeta[];
  width: number;
  height: number;
  /** Hover over the profile: the matching point on the map. */
  onProbe?(sample: Sample | null): void;
  /** Click on the profile: pick that place. */
  onPick?(sample: Sample): void;
}

const M = { top: 22, right: 14, bottom: 22, left: 34 };
const RIBBON_H = 24;
const RIBBON_GAP = 8;
const LABEL_PAD = 6;
/** The cause icon in a ribbon label, px, and the gap after it. */
const ICON = 13;
const ICON_GAP = 4;
/** Martian Mono at 11 px is wide: about 0.76 em per character. */
const CHAR_W = 8.4;
const MIN_TICK_GAP_PX = 52;
/** Temperature labels closer than this, px, would touch: every other one is dropped. */
const MIN_LEVEL_GAP_PX = 15;
/** Room left between a ribbon label and the next boundary, px. */
const LABEL_GAP_PX = 6;

export function ProfileChart({ profile, levels, cityMean, features, width, height, onProbe, onPick }: ProfileChartProps) {
  const fill = usePatternFill();
  const [probe, setProbe] = useState<Sample | null>(null);
  const clipId = `profile-area-${useId().replace(/:/g, '')}`;
  const locale = useLocale();
  const t = PROFILE_TEXTS[locale];
  const [endA, endB] = MAP_TEXTS[locale].ends;
  const { formatDeg, formatTemp, formatDegSigned, formatNumber } = useFormats();
  const wordsOf = useMemo(() => {
    const byKey = new Map(features.map((f) => [f.key, causeWords(f, locale)]));
    return (key: string) => byKey.get(key) ?? causeWords({ key, label: key, unit: '' }, locale);
  }, [features, locale]);

  const inside = profile.samples.filter((s) => s.inside);
  const plotBottom = height - M.bottom - RIBBON_H - RIBBON_GAP;
  const ribbonY = plotBottom + RIBBON_GAP;
  const length = profile.length || 1;
  const x = (d: number) => M.left + (d / length) * (width - M.left - M.right);
  const temps = inside.map((s) => s.t);
  const lo = Math.min(cityMean, ...temps) - 0.8;
  const hi = Math.max(cityMean, ...temps) + 0.8;
  const y = (t: number) => plotBottom - ((t - lo) / (hi - lo || 1)) * (plotBottom - M.top);

  const curve = (close: boolean) => {
    let d = '';
    let open = false;
    let runStart = 0;
    let last = 0;
    for (const s of profile.samples) {
      if (!s.inside) {
        if (open && close) d += `L${x(last).toFixed(1)},${plotBottom}L${x(runStart).toFixed(1)},${plotBottom}Z`;
        open = false;
        continue;
      }
      d += `${open ? 'L' : 'M'}${x(s.d).toFixed(1)},${y(s.t).toFixed(1)}`;
      if (!open) runStart = s.d;
      open = true;
      last = s.d;
    }
    if (open && close) d += `L${x(last).toFixed(1)},${plotBottom}L${x(runStart).toFixed(1)},${plotBottom}Z`;
    return d;
  };

  const step = profile.samples.length > 1 ? x(profile.samples[1]?.d ?? 0) - x(0) : 1;
  // One rect per stretch of a temperature class, so the fill has no seams between samples.
  const classRuns = runsOf(
    profile.samples.map((s) => s.d),
    profile.samples.map((s) => (s.inside ? String(classOf(levels, s.t)) : null)),
  ).filter((run) => run.tag !== null);
  const gridLevels = levels.thresholds.filter((t) => t > lo && t < hi);
  const levelGap = levels.thresholds.length > 1 ? y(levels.thresholds[0] ?? 0) - y(levels.thresholds[1] ?? 0) : Infinity;
  // Labels too close to read keep to the major levels, then every n-th of them; the grid lines all stay.
  const stride = Math.ceil(MIN_LEVEL_GAP_PX / Math.max(levelGap, 1e-6));
  const labelled = new Set(
    stride <= 1 ? levels.thresholds : levels.major.filter((_, i) => i % Math.max(1, Math.ceil(stride / 2)) === 0),
  );
  // A boundary mark at each end of every segment, except where the ribbon itself starts or ends.
  const edges = [...new Set(profile.segments.flatMap((s) => [s.d0, s.d1]))].filter((d) => d > 0 && d < profile.length);
  const kmStep = [1, 2, 5, 10].find((k) => x(k * 1000) - x(0) >= MIN_TICK_GAP_PX) ?? 20;
  const kmTicks = Array.from({ length: Math.floor(length / (kmStep * 1000)) }, (_, i) => (i + 1) * kmStep * 1000).filter(
    (d) => x(length) - x(d) > MIN_TICK_GAP_PX / 2,
  );

  const sampleUnder = (event: { currentTarget: Element; clientX: number }): Sample | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const sample = sampleAt(profile, ((event.clientX - bounds.left) / bounds.width) * length);
    return sample?.inside ? sample : null;
  };
  const move = (event: PointerEvent<SVGRectElement>) => {
    const next = sampleUnder(event);
    setProbe(next);
    onProbe?.(next);
  };
  // Read the position from the click itself: the probe state may lag one render behind.
  const click = (event: MouseEvent<SVGRectElement>) => {
    const sample = sampleUnder(event);
    if (sample) onPick?.(sample);
  };
  const leave = () => {
    setProbe(null);
    onProbe?.(null);
  };

  const probeText = probe?.cause
    ? `${formatNumber(probe.d / 1000, 1)} ${t.km} · ${formatTemp(probe.t)} · ${causeLabel(wordsOf(probe.cause.key), probe.cause.value)} ${formatDegSigned(probe.cause.value)}`
    : '';
  const probeAnchor = probe && x(probe.d) > width - 260 ? 'end' : 'start';

  return (
    <svg className="profile" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.label}>
      <defs>
        <clipPath id={clipId}>
          <path d={curve(true)} />
        </clipPath>
      </defs>

      <g className="profile__grid">
        {gridLevels.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            {labelled.has(t) && (
              <text x={M.left - 6} y={y(t) + 4} textAnchor="end">
                {formatDeg(t, 0)}
              </text>
            )}
          </g>
        ))}
      </g>

      <g clipPath={`url(#${clipId})`}>
        {classRuns.map((run) => (
          <rect
            key={run.d0}
            x={x(run.d0) - step / 2}
            width={x(run.d1) - x(run.d0) + (run.d1 === profile.length ? step : 0)}
            y={M.top}
            height={plotBottom - M.top}
            shapeRendering="crispEdges"
            style={{ fill: `var(--t${run.tag})`, fillOpacity: `var(--o${run.tag})` }}
          />
        ))}
      </g>

      <g className="profile__mean">
        <line x1={M.left} x2={width - M.right} y1={y(cityMean)} y2={y(cityMean)} />
      </g>
      <path className="profile__curve" d={curve(false)} />
      {/* Over the curve, which may run through it. */}
      <g className="profile__mean">
        <text x={width - M.right} y={y(cityMean) - 5} textAnchor="end">
          {t.mean(formatDeg(cityMean))}
        </text>
      </g>

      <g className="profile__ribbon">
        {profile.segments.map((segment) => (
          <rect
            key={`${segment.key}-${segment.d0}`}
            x={x(segment.d0)}
            y={ribbonY}
            width={Math.max(1, x(segment.d1) - x(segment.d0))}
            height={RIBBON_H}
            className="profile__segment"
            style={{ fill: fill(segment.key, segment.heats ? 'heats' : 'cools') }}
          />
        ))}
        {edges.map((d) => (
          <line key={`edge-${d}`} className="profile__edge" x1={x(d)} x2={x(d)} y1={ribbonY - 3} y2={ribbonY + RIBBON_H} />
        ))}
        {profile.segments.map((segment) => {
          const x0 = x(segment.d0);
          const words = wordsOf(segment.key);
          const label = segment.heats ? words.heatsShort : words.coolsShort;
          const labelW = ICON + ICON_GAP + label.length * CHAR_W + LABEL_PAD * 2;
          if (x(segment.d1) - x0 < labelW + LABEL_GAP_PX) return null;
          const cool = segment.heats ? '' : ' is-cool';
          return (
            <g key={`label-${segment.d0}`}>
              <rect className="profile__label-bg" x={x0 + LABEL_PAD - 3} y={ribbonY + 4} width={labelW - LABEL_PAD * 2 + 6} height={RIBBON_H - 8} rx={2} />
              <svg className={`profile__icon${cool}`} x={x0 + LABEL_PAD} y={ribbonY + (RIBBON_H - ICON) / 2} width={ICON} height={ICON} viewBox="0 0 24 24" aria-hidden="true">
                <CauseGlyph cause={segment.key} />
              </svg>
              <text className={`profile__label${cool}`} x={x0 + LABEL_PAD + ICON + ICON_GAP} y={ribbonY + RIBBON_H / 2 + 3.5}>
                {label}
              </text>
            </g>
          );
        })}
      </g>

      <g className="profile__axis">
        {kmTicks.map((d) => (
            <text key={d} x={x(d)} y={height - 6} textAnchor="middle">
              {formatNumber(d / 1000, 0)} {t.km}
            </text>
          ))}
        <text className="profile__end" x={x(0)} y={height - 6} textAnchor="middle">
          {endA}
        </text>
        <text className="profile__end" x={x(length)} y={height - 6} textAnchor="middle">
          {endB}
        </text>
      </g>

      {probe && (
        <g className="profile__probe">
          <line x1={x(probe.d)} x2={x(probe.d)} y1={M.top} y2={ribbonY + RIBBON_H} />
          {Number.isFinite(probe.t) && <circle cx={x(probe.d)} cy={y(probe.t)} r={3.5} />}
          <text x={x(probe.d) + (probeAnchor === 'end' ? -8 : 8)} y={M.top - 8} textAnchor={probeAnchor}>
            {probeText}
          </text>
        </g>
      )}

      <rect
        className="profile__hit"
        x={M.left}
        y={0}
        width={Math.max(0, width - M.left - M.right)}
        height={ribbonY + RIBBON_H}
        onPointerMove={move}
        onPointerLeave={leave}
        onClick={click}
      />
    </svg>
  );
}
