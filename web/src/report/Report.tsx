import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CityDetail } from '../data/contract';
import { hotspotProfile, type FactorMeans, type PlaceProfile } from '../domain/places';
import { recommend } from '../domain/recommendations';
import { citySummary } from '../domain/summary';
import { buildWaterfall } from '../domain/waterfall';
import { formatNumber, formatTempDelta } from '../domain/format';
import { CityPhoto } from '../ui/CityPhoto';
import { MethodContent } from '../ui/MethodContent';
import { ImportanceBars } from '../ui/panel/ImportanceBars';
import { KeyFigures } from '../ui/panel/KeyFigures';
import { ModelQuality } from '../ui/panel/ModelQuality';
import { RecommendationList } from '../ui/panel/RecommendationList';
import { WaterfallChart } from '../ui/panel/WaterfallChart';

interface ReportProps {
  detail: CityDetail;
  mapImage: string | null;
  /** The place selected on the map; the city's hottest tenth is used when nothing is selected. */
  place: PlaceProfile | null;
  cityMeans: FactorMeans;
  onClose(): void;
}

const today = () => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

export function Report({ detail, mapImage, place, cityMeans, onClose }: ReportProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const subject = useMemo(() => place ?? hotspotProfile(detail), [place, detail]);
  const waterfall = useMemo(() => buildWaterfall(subject, detail.features, detail.model.baseValue), [subject, detail]);
  const recommendations = useMemo(
    () => recommend({ features: detail.features, values: subject.values, contributions: subject.contributions, cityMeans }),
    [subject, detail, cityMeans],
  );

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('is-reporting');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('is-reporting');
    };
  }, [onClose]);

  return createPortal(
    <div className="report" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div className="report__bar no-print">
        <span className="label">Предпросмотр отчёта · A4</span>
        <button type="button" className="button button--solid" onClick={() => window.print()}>
          Распечатать или сохранить PDF
        </button>
        <button type="button" className="button" ref={closeRef} onClick={onClose}>
          Закрыть
        </button>
      </div>

      <article className="report__sheet">
        <header className="report__head">
          <div>
            <p className="eyebrow">Острова тепла · отчёт от {today()}</p>
            <h1 id="report-title" className="report__title">
              {detail.city.name}
            </h1>
            <p className="report__meta">
              {detail.city.country} · {detail.period.label} · сетка {detail.grid.cellSizeM} м,{' '}
              {formatNumber(detail.grid.count, 0)} участков
            </p>
          </div>
          <CityPhoto city={detail.city} className="report__photo" />
        </header>

        <section className="report__section report__overview">
          <KeyFigures stats={detail.stats} />
          <div className="report__summary">
            {citySummary(detail).map((p) => (
              <p key={p} className="prose">
                {p}
              </p>
            ))}
          </div>
        </section>

        {mapImage && (
          <figure className="report__map">
            <img src={mapImage} alt={`Карта температуры поверхности: ${detail.city.name}`} />
            <figcaption>Карта в том виде, в каком она была открыта при создании отчёта. Основа © OpenStreetMap, OpenFreeMap.</figcaption>
          </figure>
        )}

        <section className="report__section">
          <h2 className="section__title">Что нагревает город</h2>
          <p className="section__note">Средний вклад фактора в температуру участка, °C</p>
          <ImportanceBars detail={detail} />
        </section>

        <section className="report__section report__break">
          <h2 className="section__title">
            {subject.title}: {formatNumber(subject.lst, 1)} °C ({formatTempDelta(subject.lst - detail.stats.lstMean)} к среднему)
          </h2>
          <WaterfallChart waterfall={waterfall} />
          <h3 className="section__title">Что можно сделать</h3>
          <RecommendationList recommendations={recommendations} />
        </section>

        <section className="report__section report__break">
          <MethodContent headingLevel="h3" />
          <ModelQuality detail={detail} />
        </section>
      </article>
    </div>,
    document.body,
  );
}
