import { useEffect, useState } from 'react';

/** `#/city/<id>` is the map of a city, `#/city/<id>/method` how it was computed. No city: the first one. */
export interface Route {
  cityId: string | null;
  page: 'map' | 'method';
}

export function parseRoute(hash: string): Route {
  const [first, id, page] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (first !== 'city' || !id) return { cityId: null, page: 'map' };
  return { cityId: decodeURIComponent(id), page: page === 'method' ? 'method' : 'map' };
}

export function routeHref(cityId: string, page: Route['page'] = 'map'): string {
  return `#/city/${encodeURIComponent(cityId)}${page === 'method' ? '/method' : ''}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
