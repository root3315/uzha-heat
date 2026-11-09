import { formatDeg } from '../../domain/format';
import { classOf, type IsothermLevels } from '../../domain/isotherms';
import { useWidth } from '../hooks';

interface RampProps {
  levels: IsothermLevels;
  /** Share of the city's area in each class: each step is as wide as the ground it covers. */
  shares: number[];
  min: number;
  max: number;
  value: number;
  meanMark: number | null;
}

const BAR_Y = 22;
const BAR_H = 12;
const LABEL_GAP = 22;

/** The city as a strip of its own temperature classes, with the shown place marked on it. */
export function Ramp({ levels, shares, min, max, value, meanMark }: RampProps) {
  const [ref, width] = useWidth<HTMLDivElement>(340);
  const edges = shares.reduce<number[]>((acc, share) => [...acc, (acc[acc.length - 1] ?? 0) + share * width], [0]);
  const floor = (k: number) => (k === 0 ? min : (levels.thresholds[k - 1] ?? min));
  const ceil = (k: number) => (k === levels.thresholds.length ? max : (levels.thresholds[k] ?? max));
  const xOf = (t: number) => {
    const k = classOf(levels, t);
    const f = Math.max(0, Math.min(1, (t - floor(k)) / (ceil(k) - floor(k) || 1)));
    const x0 = edges[k] ?? 0;
    return x0 + f * ((edges[k + 1] ?? x0) - x0);
  };

  let lastLabel = -Infinity;
  const labels = levels.thresholds.flatMap((t, i) => {
    const x = edges[i + 1] ?? 0;
    if (x - lastLabel < LABEL_GAP || x > width - 8) return [];
    lastLabel = x;
    return [{ t, x }];
  });
  const marker = xOf(value);
  const anchor = marker > width - 36 ? 'end' : marker < 36 ? 'start' : 'middle';

  return (
    <div ref={ref} className="ramp">
      <svg width={width} height={BAR_Y + BAR_H + 20} role="img" aria-label={`Шкала температуры города, отмечено ${formatDeg(value)}`}>
        {shares.map((_, k) => {
          const x0 = edges[k] ?? 0;
          const w = Math.max(0, (edges[k + 1] ?? x0) - x0 - 1);
          return <rect key={k} x={x0} y={BAR_Y} width={w} height={BAR_H} style={{ fill: `var(--t${k})` }} />;
        })}
        {labels.map(({ t, x }) => (
          <text key={t} className="ramp__tick" x={x} y={BAR_Y + BAR_H + 14} textAnchor="middle">
            {formatDeg(t, 0)}
          </text>
        ))}
        {meanMark !== null && <line className="ramp__mean" x1={xOf(meanMark)} x2={xOf(meanMark)} y1={BAR_Y - 3} y2={BAR_Y + BAR_H + 3} />}
        <g className="ramp__marker">
          <path d={`M${marker - 4.5},${BAR_Y - 9} L${marker + 4.5},${BAR_Y - 9} L${marker},${BAR_Y - 2} Z`} />
          <text x={Math.min(width, Math.max(0, marker))} y={BAR_Y - 13} textAnchor={anchor}>
            {formatDeg(value)}
          </text>
        </g>
      </svg>
    </div>
  );
}
