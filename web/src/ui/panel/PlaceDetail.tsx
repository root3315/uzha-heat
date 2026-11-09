import { useMemo } from 'react';
import type { CityDetail } from '../../data/contract';
import { formatNumber, formatTempDelta } from '../../domain/format';
import type { FactorMeans, PlaceProfile } from '../../domain/places';
import { recommend } from '../../domain/recommendations';
import { buildWaterfall } from '../../domain/waterfall';
import { RecommendationList } from './RecommendationList';
import { WaterfallChart } from './WaterfallChart';

interface PlaceDetailProps {
  detail: CityDetail;
  place: PlaceProfile;
  cityMeans: FactorMeans;
  onBack(): void;
}

function placeCaption(place: PlaceProfile): string {
  if (place.center) {
    const [lon, lat] = place.center;
    return `${formatNumber(lat, 4)}° с. ш. · ${formatNumber(lon, 4)}° в. д.`;
  }
  return `${formatNumber(place.cellCount, 0)} участков по 200 м`;
}

export function PlaceDetail({ detail, place, cityMeans, onBack }: PlaceDetailProps) {
  const waterfall = useMemo(() => buildWaterfall(place, detail.features, detail.model.baseValue), [place, detail]);
  const recommendations = useMemo(
    () => recommend({ features: detail.features, values: place.values, contributions: place.contributions, cityMeans }),
    [place, detail, cityMeans],
  );
  const delta = place.lst - detail.stats.lstMean;

  return (
    <div className="panel__body">
      <button type="button" className="link-button" onClick={onBack}>
        ← Весь город
      </button>
      <header className="panel__head">
        <p className="eyebrow">{placeCaption(place)}</p>
        <h1 className="place__title">{place.title}</h1>
        <p className="figures__main">
          <span className="figure figure--hero">
            {formatNumber(place.lst, 1)}
            <span className="unit">°C</span>
          </span>
          <span className="figures__caption">
            <strong className={`delta ${delta >= 0 ? 'is-heating' : 'is-cooling'}`}>{formatTempDelta(delta)}</strong> к
            среднему по городу
          </span>
        </p>
      </header>

      <section className="section" aria-labelledby="breakdown-heading">
        <h2 id="breakdown-heading" className="section__title">
          Откуда эта температура
        </h2>
        <WaterfallChart waterfall={waterfall} />
      </section>

      <section className="section" aria-labelledby="recs-heading">
        <h2 id="recs-heading" className="section__title">
          Что можно сделать
        </h2>
        <RecommendationList recommendations={recommendations} />
      </section>
    </div>
  );
}
