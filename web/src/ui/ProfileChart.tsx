import { useId, useMemo, useState, type MouseEvent, type PointerEvent } from 'react';
import { causeLabel, causeWords } from '../domain/causes';
import { formatDeg, formatDegSigned, formatNumber } from '../domain/format';
import { classOf, type IsothermLevels } from '../domain/isotherms';
import { sampleAt, type Profile, type Sample } from '../domain/transect';
import type { FeatureMeta } from '../data/contract';
import { patternFill } from './patterns';

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
const RIBBON_H = 20;
const RIBBON_GAP = 6;
const LABEL_PAD = 4;
const CHAR_W = 6.1;
const MIN_TICK_GAP_PX = 52;

export function ProfileChart({ profile, levels, cityMean, features, width, height, onProbe, onPick }: ProfileChartProps) {
  const [probe, setProbe] = useState<Sample | null>(null);
  const clipId = `profile-area-${useId().replace(/:/g, '')}`;
  const wordsOf = useMemo(() => {
    const byKey = new Map(features.map((f) => [f.key, causeWords(f)]));
    return (key: string) => byKey.get(key) ?? causeWords({ key, label: key, unit: '' });
  }, [features]);

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
  const gridLevels = levels.thresholds.filter((t) => t > lo && t < hi);
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
    ? `${formatNumber(probe.d / 1000, 1)} км · ${formatDeg(probe.t)} · ${causeLabel(wordsOf(probe.cause.key), probe.cause.value)} ${formatDegSigned(probe.cause.value)}`
    : '';
  const probeAnchor = probe && x(probe.d) > width - 260 ? 'end' : 'start';

  return (
    <svg className="profile" width={width} height={height} role="img" aria-label="Температура и причины вдоль разреза">
      <defs>
        <clipPath id={clipId}>
          <path d={curve(true)} />
        </clipPath>
      </defs>

      <g className="profile__grid">
        {gridLevels.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end">
              {formatDeg(t, 0)}
            </text>
          </g>
        ))}
      </g>

      <g clipPath={`url(#${clipId})`}>
        {inside.map((s) => (
          <rect key={s.d} x={x(s.d) - step / 2} width={step + 0.6} y={M.top} height={plotBottom - M.top} style={{ fill: `var(--t${classOf(levels, s.t)})`, fillOpacity: `var(--o${classOf(levels, s.t)})` }} />
        ))}
      </g>

      <g className="profile__mean">
        <line x1={M.left} x2={width - M.right} y1={y(cityMean)} y2={y(cityMean)} />
        <text x={width - M.right} y={y(cityMean) - 5} textAnchor="end">
          среднее {formatDeg(cityMean)}
        </text>
      </g>
      <path className="profile__curve" d={curve(false)} />

      <g className="profile__ribbon">
        {profile.segments.map((segment) => {
          const x0 = x(segment.d0);
          const x1 = x(segment.d1);
          const words = wordsOf(segment.key);
          const label = segment.heats ? words.heatsShort : words.coolsShort;
          const labelW = label.length * CHAR_W + LABEL_PAD * 2;
          return (
            <g key={`${segment.key}-${segment.d0}`}>
              <rect
                x={x0}
                y={ribbonY}
                width={Math.max(1, x1 - x0 - 1)}
                height={RIBBON_H}
                style={{ fill: patternFill(segment.key, segment.heats ? 'heats' : 'cools') }}
              />
              {x1 - x0 > labelW + 6 && (
                <g>
                  <rect className="profile__label-bg" x={x0 + 3} y={ribbonY + 3} width={labelW} height={RIBBON_H - 6} />
                  <text className={segment.heats ? 'profile__label' : 'profile__label is-cool'} x={x0 + 3 + LABEL_PAD} y={ribbonY + RIBBON_H / 2 + 4}>
                    {label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      <g className="profile__axis">
        {kmTicks.map((d) => (
            <text key={d} x={x(d)} y={height - 6} textAnchor="middle">
              {formatNumber(d / 1000, 0)} км
            </text>
          ))}
        <text className="profile__end" x={x(0)} y={height - 6} textAnchor="middle">
          А
        </text>
        <text className="profile__end" x={x(length)} y={height - 6} textAnchor="middle">
          Б
        </text>
      </g>

      {probe && (
        <g className="profile__probe">
          <line x1={x(probe.d)} x2={x(probe.d)} y1={M.top} y2={ribbonY + RIBBON_H} />
          <circle cx={x(probe.d)} cy={y(probe.t)} r={3.5} />
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
