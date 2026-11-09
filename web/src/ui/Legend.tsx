import { useMemo } from 'react';
import type { CityDetail } from '../data/contract';
import { DIVERGING_RAMP, HEAT_RAMP, NO_HEATING_COLOR, rampGradient } from '../domain/colorScales';
import { formatNumber, formatPercent, formatSigned } from '../domain/format';
import { dominantFactorPerCell } from '../domain/places';
import type { Granularity, MapMode, MapScales } from '../map/mapMode';

interface LegendProps {
  detail: CityDetail;
  scales: MapScales;
  mode: MapMode;
  granularity: Granularity;
}

function GradientLegend({ title, gradient, ticks, ends }: { title: string; gradient: string; ticks: string[]; ends?: [string, string] }) {
  return (
    <>
      <p className="legend__title">{title}</p>
      <div className="legend__ramp" style={{ backgroundImage: gradient }} />
      <div className="legend__ticks">
        {ticks.map((tick, i) => (
          <span key={i}>{tick}</span>
        ))}
      </div>
      {ends && (
        <div className="legend__ends">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </>
  );
}

function DominantLegend({ detail, scales }: { detail: CityDetail; scales: MapScales }) {
  const shares = useMemo(() => {
    const dominant = dominantFactorPerCell(detail);
    const counts = new Map<string, number>();
    for (const key of dominant) counts.set(key ?? '', (counts.get(key ?? '') ?? 0) + 1);
    const total = dominant.length || 1;
    const rows = detail.features
      .map((f) => ({ key: f.key, label: f.label, color: scales.factorColors[f.key] ?? NO_HEATING_COLOR, share: (counts.get(f.key) ?? 0) / total }))
      .filter((row) => row.share > 0)
      .sort((a, b) => b.share - a.share);
    const none = (counts.get('') ?? 0) / total;
    return none > 0 ? [...rows, { key: '', label: 'Ничто не нагревает', color: NO_HEATING_COLOR, share: none }] : rows;
  }, [detail, scales]);

  return (
    <>
      <p className="legend__title">Главная причина нагрева</p>
      <ul className="legend__swatches">
        {shares.map((row) => (
          <li key={row.key || 'none'}>
            <span className="legend__swatch" style={{ background: row.color }} />
            <span>{row.label}</span>
            <span className="legend__share">{formatPercent(row.share)}</span>
          </li>
        ))}
      </ul>
      <p className="legend__note">Доля участков 200 м</p>
    </>
  );
}

export function Legend({ detail, scales, mode, granularity }: LegendProps) {
  const unitNote = granularity === 'districts' ? ', среднее по району' : '';
  let body;
  if (mode.kind === 'lst') {
    const lo = scales.heat[0]?.[0] ?? 0;
    const hi = scales.heat[scales.heat.length - 1]?.[0] ?? 0;
    const mid = (lo + hi) / 2;
    body = (
      <GradientLegend
        title={`Температура поверхности летом, °C${unitNote}`}
        gradient={rampGradient(HEAT_RAMP)}
        ticks={[`≤${formatNumber(lo, 0)}`, formatNumber(mid, 0), `≥${formatNumber(hi, 0)}`]}
      />
    );
  } else if (mode.kind === 'shap') {
    const range = scales.shapRange[mode.key] ?? 1;
    const label = detail.features.find((f) => f.key === mode.key)?.label ?? mode.key;
    body = (
      <GradientLegend
        title={`Вклад: ${label.toLowerCase()}, °C${unitNote}`}
        gradient={rampGradient(DIVERGING_RAMP)}
        ticks={[formatSigned(-range, 1), '0', formatSigned(range, 1)]}
        ends={['охлаждает', 'нагревает']}
      />
    );
  } else {
    body = <DominantLegend detail={detail} scales={scales} />;
  }
  return (
    <div className="legend" aria-live="polite">
      {body}
    </div>
  );
}
