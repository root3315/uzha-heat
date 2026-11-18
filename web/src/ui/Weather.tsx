import type { CitySummary, Weather } from '../data/contract';
import { cityName } from '../domain/dataTexts';
import { overpassLine, summerFigures, weatherComparison, weatherSource, withWeather } from '../domain/weather';
import { useLocale } from './locale';
import { WEATHER_UI_TEXTS } from './ui.texts';

/** One city's summer in six numbers, what the air was like at the satellite pictures, and the source. */
export function WeatherSummary({ weather }: { weather: Weather }) {
  const locale = useLocale();
  const t = WEATHER_UI_TEXTS[locale];
  const overpass = overpassLine(weather, locale);
  return (
    <section className="wx" aria-labelledby="wx-title">
      <h2 id="wx-title" className="wx__title">
        {t.title}
      </h2>
      <dl className="wx__figs">
        {summerFigures(weather, locale).map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {overpass && <p className="wx__note">{overpass}</p>}
      <p className="wx__source">
        {weatherSource(weather, locale)} {t.airNotSurface}
      </p>
    </section>
  );
}

interface WeatherCompareProps {
  cities: readonly CitySummary[];
  /** Marked in the table; null on the landing, where no city is the current one. */
  currentId: string | null;
  className?: string;
}

/** The cities' summers side by side: a row per measure, a column per city, and what the difference means. */
export function WeatherCompare({ cities, currentId, className = 'wx-table' }: WeatherCompareProps) {
  const locale = useLocale();
  const t = WEATHER_UI_TEXTS[locale];
  const known = cities.filter((c): c is CitySummary & { weather: Weather } => c.weather !== undefined);
  const first = known[0];
  if (!first || known.length < 2) return null;
  const columns = known.map((c) => summerFigures(c.weather, locale));
  const sentence = weatherComparison(withWeather(known, locale), locale);
  return (
    <div className="wx-compare">
      {sentence && <p className="wx-compare__lead">{sentence}</p>}
      <table className={className}>
        <thead>
          <tr>
            <th scope="col">{t.summer}</th>
            {known.map((c) => (
              <th key={c.id} scope="col" className={c.id === currentId ? 'is-current' : undefined}>
                {cityName(c, locale)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summerFigures(first.weather, locale).map((row, r) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {columns.map((figures, i) => (
                <td key={known[i]?.id}>{figures[r]?.value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="wx__source">
        {weatherSource(first.weather, locale)} {t.airNotSurface}
      </p>
    </div>
  );
}
