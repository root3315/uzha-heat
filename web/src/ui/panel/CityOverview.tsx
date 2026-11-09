import type { CityDetail } from '../../data/contract';
import { citySummary } from '../../domain/summary';
import type { MapMode, MapScales } from '../../map/mapMode';
import { DistrictRanking } from './DistrictRanking';
import { ImportanceBars } from './ImportanceBars';
import { KeyFigures } from './KeyFigures';
import { ModelQuality } from './ModelQuality';

interface CityOverviewProps {
  detail: CityDetail;
  mode: MapMode;
  scales: MapScales;
  onShowFactor(key: string): void;
  onSelectDistrict(index: number): void;
}

export function CityOverview({ detail, mode, scales, onShowFactor, onSelectDistrict }: CityOverviewProps) {
  const [lead, ...rest] = citySummary(detail);
  return (
    <div className="panel__body">
      <header className="panel__head">
        <p className="eyebrow">
          {detail.city.name} · {detail.city.country}
        </p>
        <KeyFigures stats={detail.stats} />
        <p className="panel__lead">{lead}</p>
      </header>

      <section className="section" aria-labelledby="drivers-heading">
        <h2 id="drivers-heading" className="section__title">
          Что нагревает город
        </h2>
        <p className="section__note">Средний вклад фактора в температуру участка, °C. Нажмите, чтобы увидеть его на карте.</p>
        <ImportanceBars detail={detail} activeKey={mode.kind === 'shap' ? mode.key : undefined} onShowFactor={onShowFactor} />
        {rest.map((paragraph) => (
          <p key={paragraph} className="prose">
            {paragraph}
          </p>
        ))}
      </section>

      {detail.districts.length > 0 && (
        <section className="section" aria-labelledby="districts-heading">
          <h2 id="districts-heading" className="section__title">
            Районы по температуре
          </h2>
          <DistrictRanking detail={detail} scales={scales} onSelect={onSelectDistrict} />
        </section>
      )}

      <p className="hint">Нажмите на любой участок карты — покажем, что именно его нагревает и что с этим делать.</p>
      <ModelQuality detail={detail} />
    </div>
  );
}
