import type { CitySummary, Weather } from '../data/contract';
import { overpassLine, summerFigures, weatherComparison, weatherSource, withWeather } from '../domain/weather';

/** One city's summer in six numbers, what the air was like at the satellite pictures, and the source. */
export function WeatherSummary({ weather }: { weather: Weather }) {
  const overpass = overpassLine(weather);
  return (
    <section className="wx" aria-labelledby="wx-title">
      <h2 id="wx-title" className="wx__title">
        Погода этим летом
      </h2>
      <dl className="wx__figs">
        {summerFigures(weather).map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {overpass && <p className="wx__note">{overpass}</p>}
      <p className="wx__source">{weatherSource(weather)} Это воздух, а&nbsp;не&nbsp;поверхность.</p>
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
  const known = cities.filter((c): c is CitySummary & { weather: Weather } => c.weather !== undefined);
  const first = known[0];
  if (!first || known.length < 2) return null;
  const columns = known.map((c) => summerFigures(c.weather));
  const sentence = weatherComparison(withWeather(known));
  return (
    <div className="wx-compare">
      {sentence && <p className="wx-compare__lead">{sentence}</p>}
      <table className={className}>
        <thead>
          <tr>
            <th scope="col">Лето</th>
            {known.map((c) => (
              <th key={c.id} scope="col" className={c.id === currentId ? 'is-current' : undefined}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summerFigures(first.weather).map((row, r) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {columns.map((figures, i) => (
                <td key={known[i]?.id}>{figures[r]?.value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="wx__source">{weatherSource(first.weather)} Это воздух, а&nbsp;не&nbsp;поверхность.</p>
    </div>
  );
}
