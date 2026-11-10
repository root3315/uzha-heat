import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HtmlTagDescriptor, Plugin, ResolvedConfig } from 'vite';

/** Font files the first screen sets text in: the headline and the bar (Tektur), the captions (Onest). */
const FIRST_SCREEN_FONTS = [/tektur-cyrillic-standard-normal-[\w-]+\.woff2$/, /tektur-latin-standard-normal-[\w-]+\.woff2$/, /onest-cyrillic-wght-normal-[\w-]+\.woff2$/];

interface DefaultCity {
  id: string;
  name: string;
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

function defaultCity(dataDir: string): DefaultCity {
  const cities = readJson(join(dataDir, 'cities.json'));
  const first = Array.isArray(cities) ? (cities[0] as Partial<DefaultCity> | undefined) : undefined;
  if (!first?.id || !first.name) throw new Error('cities.json: no first city for the loading screen');
  return { id: first.id, name: first.name };
}

/**
 * The first screen before the app runs: the opening city's file and the first-screen fonts preloaded,
 * and the display face held back until it is ready instead of flashing a fallback.
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
  };

  /** Fonts first (small, and the headline waits for them), then the opening city: its list, outline and file. */
  const preloads: Plugin = {
    name: 'uzha-boot-preloads',
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
          preload('fetch', `boundaries/${city.id}.geojson`),
          preload('fetch', `data/${city.id}.json`),
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
