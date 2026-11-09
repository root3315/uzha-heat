import { MissingDataError, loadBoundary, loadCity } from '../data/load';
import { buildCityModel, type CityModel } from '../domain/cityModel';

const cache = new Map<string, Promise<CityModel | null>>();

async function build(id: string): Promise<CityModel | null> {
  const [detail, outline] = await Promise.all([
    loadCity(id).catch((error: unknown) => {
      if (error instanceof MissingDataError) return null;
      throw error;
    }),
    loadBoundary(id),
  ]);
  if (!detail) return null;
  // Let the loading state paint before the surface is computed.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return buildCityModel(detail, outline);
}

/** One model per city for the whole page: the map, the city rows and the method share it. Null: no data yet. */
export function cityModel(id: string): Promise<CityModel | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = build(id);
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}
