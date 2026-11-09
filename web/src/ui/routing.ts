import { useEffect, useState } from 'react';

/**
 * One page: `/` opens on the story, `/map/<id>` opens on the tool part of the same page for that city,
 * `/method/<id>` is the full method. Old `#/city/<id>` links still land on the tool.
 */
export type Route = { view: 'story' | 'tool' | 'method'; cityId: string | null };

const BASE = import.meta.env.BASE_URL;

export function parseRoute(pathname: string, hash = '', base = '/'): Route {
  const legacy = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (legacy[0] === 'city' && legacy[1]) {
    return { view: legacy[2] === 'method' ? 'method' : 'tool', cityId: decodeURIComponent(legacy[1]) };
  }
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  const [first, id] = path.split('/').filter(Boolean);
  const cityId = id ? decodeURIComponent(id) : null;
  if (first === 'map') return { view: 'tool', cityId };
  if (first === 'method') return { view: 'method', cityId };
  return { view: 'story', cityId: null };
}

export function toolHref(cityId: string, base = BASE): string {
  return `${base}map/${encodeURIComponent(cityId)}`;
}

export function methodHref(cityId: string, base = BASE): string {
  return `${base}method/${encodeURIComponent(cityId)}`;
}

const NAVIGATE = 'uzha:navigate';

const current = () => parseRoute(window.location.pathname, window.location.hash, BASE);

/** In-page navigation: a new history entry and the route updated, no reload. */
export function navigate(href: string): void {
  window.history.pushState(null, '', href);
  window.dispatchEvent(new Event(NAVIGATE));
}

/** Correct the address in place: no new history entry, the route updated. */
export function redirect(href: string): void {
  window.history.replaceState(null, '', href);
  window.dispatchEvent(new Event(NAVIGATE));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    window.addEventListener(NAVIGATE, onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener(NAVIGATE, onChange);
    };
  }, []);
  return route;
}
