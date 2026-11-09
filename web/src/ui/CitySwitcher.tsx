import type { CitySummary } from '../data/contract';
import { routeHref } from './routing';

/** A plain select dressed as a line of text: the city is context here, not a destination. */
export function CitySwitcher({ cities, currentId }: { cities: CitySummary[]; currentId: string }) {
  return (
    <label className="city-switcher">
      <span className="visually-hidden">Город</span>
      <select value={currentId} onChange={(event) => window.location.assign(routeHref(event.target.value))}>
        {cities.map((city) => (
          <option key={city.id} value={city.id}>
            {city.name}
          </option>
        ))}
      </select>
      <svg className="city-switcher__chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
        <path d="M1 1l4 4 4-4" />
      </svg>
    </label>
  );
}
