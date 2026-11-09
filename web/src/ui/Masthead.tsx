import type { CitySummary } from '../data/contract';
import { routeHref } from './routing';

interface MastheadProps {
  city?: CitySummary;
}

export function Masthead({ city }: MastheadProps) {
  return (
    <header className="masthead">
      <a className="masthead__brand" href={routeHref({ page: 'cities' })}>
        Острова тепла
        <span className="masthead__sub">города Узбекистана</span>
      </a>
      {city && (
        <span className="masthead__crumb">
          <span aria-hidden>/</span> {city.name}
        </span>
      )}
      <nav className="masthead__nav" aria-label="Разделы">
        <a href={routeHref({ page: 'cities' })}>Города</a>
        <a href={routeHref({ page: 'method' })}>Метод и данные</a>
      </nav>
    </header>
  );
}
