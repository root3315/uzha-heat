import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HtmlTagDescriptor, Plugin, ResolvedConfig } from 'vite';
import { boundaryGeometry } from '../src/data/boundary';
import { outlinePath } from '../src/domain/outlinePath';

/** Font files the first screen sets text in: the headline and the bar (Tektur), the captions (Onest). */
const FIRST_SCREEN_FONTS = [
  /tektur-latin-standard-normal-[\w-]+\.woff2$/,
  /onest-latin-wght-normal-[\w-]+\.woff2$/,
  /tektur-cyrillic-standard-normal-[\w-]+\.woff2$/,
  /onest-cyrillic-wght-normal-[\w-]+\.woff2$/,
];

interface DefaultCity {
  id: string;
  name: string;
  nameEn: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Decoded size of every city file: the honest total for the download progress, even when the server gzips. */
function dataBytes(dataDir: string): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const file of readdirSync(dataDir)) {
    if (file.endsWith('.json') && file !== 'cities.json') sizes[file.slice(0, -'.json'.length)] = statSync(join(dataDir, file)).size;
  }
  return sizes;
}

/** Every city id in the list, for the preload script to check the address against. */
function cityIds(dataDir: string): string[] {
  const cities = readJson(join(dataDir, 'cities.json'));
  return Array.isArray(cities) ? cities.flatMap((c: { id?: unknown }) => (typeof c?.id === 'string' ? [c.id] : [])) : [];
}

/**
 * A tiny external script (the server's CSP allows no inline ones) that preloads the city in the address:
 * /map/bukhara starts fetching Bukhara, not the opening city. Unknown or no city: the opening one.
 */
function preloadScript(base: string, ids: string[], fallback: string): string {
  return `(function () {
  var ids = ${JSON.stringify(ids)};
  var m = location.pathname.slice(${JSON.stringify(base)}.length - 1).match(new RegExp('^/(?:map|method)/([^/?#]+)'));
  var id = m && ids.indexOf(decodeURIComponent(m[1])) >= 0 ? decodeURIComponent(m[1]) : ${JSON.stringify(fallback)};
  ['boundaries/' + id + '.geojson', 'data/' + id + '.json'].forEach(function (href) {
    var link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'fetch';
    link.crossOrigin = '';
    link.href = ${JSON.stringify(base)} + href;
    document.head.appendChild(link);
  });
})();
`;
}

const PRELOAD_FILE = 'preload-city.js';

function defaultCity(dataDir: string): DefaultCity {
  const cities = readJson(join(dataDir, 'cities.json'));
  const first = Array.isArray(cities) ? (cities[0] as Partial<DefaultCity> | undefined) : undefined;
  if (!first?.id || !first.name) throw new Error('cities.json: no first city for the loading screen');
  return { id: first.id, name: first.name, nameEn: first.nameEn || first.name };
}

/**
 * The first screen before the app runs: the opening city's names (English shown, Russian kept for the switch) and outline baked into index.html,
 * the city file and the first-screen fonts preloaded, and the display face held back until it is ready
 * instead of flashing a fallback.
 */
export function boot(): Plugin[] {
  let config: ResolvedConfig;
  let city: DefaultCity;

  const fill: Plugin = {
    name: 'uzha-boot',
    config(user) {
      const dataDir = join(user.root ?? process.cwd(), user.publicDir || 'public', 'data');
      return { define: { __DATA_BYTES__: JSON.stringify(dataBytes(dataDir)) } };
    },
    configResolved(resolved) {
      config = resolved;
      city = defaultCity(join(resolved.publicDir, 'data'));
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const geometry = boundaryGeometry(readJson(join(config.publicDir, 'boundaries', `${city.id}.geojson`)));
        const outline = geometry ? outlinePath(geometry) : { d: '', width: 1000, height: 1000 };
        const page = html
          .replaceAll('__UZHA_CITY_NAME_RU__', city.name)
          .replaceAll('__UZHA_CITY_NAME__', city.nameEn)
          .replaceAll('__UZHA_CITY_ID__', city.id)
          .replace('__UZHA_OUTLINE_VIEWBOX__', `0 0 ${outline.width} ${outline.height}`)
          .replace('__UZHA_OUTLINE_D__', outline.d);
        return page;
      },
    },
  };

  /** Fonts first (small, and the headline waits for them), then the city of the address: its list, outline and file. */
  const preloads: Plugin = {
    name: 'uzha-boot-preloads',
    generateBundle() {
      const ids = cityIds(join(config.publicDir, 'data'));
      this.emitFile({ type: 'asset', fileName: PRELOAD_FILE, source: preloadScript(config.base, ids, city.id) });
    },
    configureServer(server) {
      server.middlewares.use(`${config.base}${PRELOAD_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(preloadScript(config.base, cityIds(join(config.publicDir, 'data')), city.id));
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const preload = (as: 'font' | 'fetch', href: string): HtmlTagDescriptor => ({
          tag: 'link',
          attrs: { rel: 'preload', as, ...(as === 'font' ? { type: 'font/woff2' } : {}), crossorigin: '', href: `${config.base}${href}` },
          injectTo: 'head',
        });
        // The dev server has no bundle: its fonts have no fixed names to preload.
        const fonts = Object.keys(bundle ?? {}).filter((file) => FIRST_SCREEN_FONTS.some((pattern) => pattern.test(file)));
        return [
          ...fonts.map((file) => preload('font', file)),
          preload('fetch', 'data/cities.json'),
          // The city itself is preloaded by the address, in a script of its own (see preloadScript).
          { tag: 'script', attrs: { src: `${config.base}${PRELOAD_FILE}` }, injectTo: 'head' },
        ];
      },
    },
  };

  /** The headline face waits for its file (preloaded, ~15 kB) rather than showing Arial Narrow first. */
  const blockDisplayFace: Plugin = {
    name: 'uzha-boot-display-face',
    enforce: 'pre',
    transform(code, id) {
      if (!/@fontsource-variable\/tektur\/.*\.css$/.test(id)) return null;
      return { code: code.replaceAll('font-display: swap', 'font-display: block'), map: null };
    },
  };

  return [fill, preloads, blockDisplayFace];
}
