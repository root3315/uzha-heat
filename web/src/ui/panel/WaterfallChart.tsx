import type { Waterfall } from '../../domain/waterfall';
import { formatNumber, formatSigned } from '../../domain/format';

interface WaterfallChartProps {
  waterfall: Waterfall;
}

function axisDomain(w: Waterfall): [number, number] {
  const values = [w.base, w.predicted, w.observed, ...w.steps.flatMap((s) => [s.start, s.end])];
  return [Math.floor(Math.min(...values)), Math.ceil(Math.max(...values))];
}

function tickValues(lo: number, hi: number): number[] {
  const step = hi - lo > 12 ? 4 : hi - lo > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  return ticks;
}

/**
 * From the model's base temperature to this place's temperature, one factor at a time,
 * drawn on a shared °C scale like a ruled instrument.
 */
export function WaterfallChart({ waterfall }: WaterfallChartProps) {
  const [lo, hi] = axisDomain(waterfall);
  const span = Math.max(hi - lo, 1);
  const x = (value: number) => `${((value - lo) / span) * 100}%`;
  const width = (a: number, b: number) => `${(Math.abs(b - a) / span) * 100}%`;

  const marker = (label: string, value: number, strong = false) => (
    <li className={`waterfall__row waterfall__row--marker${strong ? ' is-strong' : ''}`}>
      <span className="waterfall__label">{label}</span>
      <span className="waterfall__track">
        <span className="waterfall__marker" style={{ left: x(value) }} />
      </span>
      <span className="waterfall__value">{formatNumber(value, 1)}°</span>
    </li>
  );

  return (
    <figure className="waterfall">
      <div className="waterfall__axis" aria-hidden>
        <span />
        <span className="waterfall__track">
          {tickValues(lo, hi).map((t) => (
            <span key={t} className="waterfall__tick" style={{ left: x(t) }}>
              {t}°
            </span>
          ))}
        </span>
        <span />
      </div>
      <ol className="waterfall__rows">
        {marker('Базовое значение', waterfall.base)}
        {waterfall.steps.map((step) => {
          const tone = step.delta >= 0 ? 'is-heating' : 'is-cooling';
          return (
            <li key={step.key} className="waterfall__row">
              <span className="waterfall__label">{step.label}</span>
              <span className="waterfall__track">
                <span
                  className={`waterfall__bar ${tone}`}
                  style={{ left: x(Math.min(step.start, step.end)), width: width(step.start, step.end) }}
                />
              </span>
              <span className={`waterfall__value ${tone}`}>{formatSigned(step.delta, 1)}</span>
            </li>
          );
        })}
        {marker('Оценка модели', waterfall.predicted)}
        {marker('По снимкам', waterfall.observed, true)}
      </ol>
      <figcaption className="waterfall__caption">
        Базовое значение — средняя оценка модели по городу. Расхождение оценки и снимков (
        {formatSigned(waterfall.residual, 1)}&nbsp;°C) — то, что модель не объяснила.
      </figcaption>
    </figure>
  );
}
