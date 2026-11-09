import type { LstStats } from '../../data/contract';
import { formatNumber } from '../../domain/format';

export function KeyFigures({ stats }: { stats: LstStats }) {
  return (
    <div className="figures">
      <p className="figures__main">
        <span className="figure figure--hero">
          {formatNumber(stats.lstMean, 1)}
          <span className="unit">°C</span>
        </span>
        <span className="figures__caption">средняя температура поверхности летом</span>
      </p>
      <dl className="figures__row">
        <div>
          <dt>Горячие 10 % — выше</dt>
          <dd className="figure">{formatNumber(stats.lstP90, 1)}°</dd>
        </div>
        <div>
          <dt>Прохладные 10 % — ниже</dt>
          <dd className="figure">{formatNumber(stats.lstP10, 1)}°</dd>
        </div>
        <div>
          <dt>Разброс</dt>
          <dd className="figure">{formatNumber(stats.lstP90 - stats.lstP10, 1)}°</dd>
        </div>
      </dl>
    </div>
  );
}
