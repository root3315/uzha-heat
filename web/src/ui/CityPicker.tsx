import type { CitySummary } from '../data/contract';
import { formatNumber } from '../domain/format';
import { CityPhoto } from './CityPhoto';
import { routeHref } from './routing';

interface CityPickerProps {
  cities: CitySummary[];
}

export function CityPicker({ cities }: CityPickerProps) {
  return (
    <main className="picker">
      <section className="picker__intro">
        <p className="eyebrow">Городские острова тепла</p>
        <h1 className="picker__title">Где город перегревается — и&nbsp;почему</h1>
        <p className="picker__lead">
          Спутник Landsat видит, где летом раскаляется поверхность улиц. Модель раскладывает эту температуру на причины —
          зелень, застройку, открытый грунт, воду — и для каждого участка 200&nbsp;×&nbsp;200&nbsp;м показывает, что его
          нагревает и что с этим делать.
        </p>
      </section>

      <section className="picker__list" aria-labelledby="cities-heading">
        <div className="picker__list-head">
          <h2 id="cities-heading" className="label">
            Города · {cities.length}
          </h2>
          <span className="label picker__col">Поверхность летом</span>
          <span className="label picker__col">Точность модели</span>
        </div>
        <ul>
          {cities.map((city) => (
            <li key={city.id}>
              <a className="city-row" href={routeHref({ page: 'city', cityId: city.id })}>
                <CityPhoto city={city} className="city-row__photo" />
                <span className="city-row__name">
                  {city.name}
                  <span className="city-row__country">{city.country}</span>
                </span>
                <span className="city-row__figure">
                  {formatNumber(city.lstMean, 1)}
                  <span className="unit">°C</span>
                </span>
                <span className="city-row__r2">
                  R² {formatNumber(city.r2, 2)}
                  <span className="city-row__go" aria-hidden>
                    Открыть карту →
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="picker__sources">
        Данные: Landsat 8/9, Sentinel-2, ESA WorldCover, Copernicus DEM, OpenStreetMap.{' '}
        <a href={routeHref({ page: 'method' })}>Как это посчитано</a>
      </p>
    </main>
  );
}
