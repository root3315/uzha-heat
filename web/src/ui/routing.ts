import { useEffect, useState } from 'react';

export type Route = { page: 'cities' } | { page: 'city'; cityId: string } | { page: 'method' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'city' && parts[1]) return { page: 'city', cityId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'method') return { page: 'method' };
  return { page: 'cities' };
}

export function routeHref(route: Route): string {
  if (route.page === 'city') return `#/city/${encodeURIComponent(route.cityId)}`;
  if (route.page === 'method') return '#/method';
  return '#/';
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
