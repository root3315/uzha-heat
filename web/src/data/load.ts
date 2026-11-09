import type { CityDetail, CitySummary } from './contract';
import { parseCities, parseCityDetail } from './parse';

const DATA_ROOT = `${import.meta.env.BASE_URL}data`;

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${DATA_ROOT}/${path}`);
  if (!response.ok) throw new Error(`Не удалось загрузить ${path} (HTTP ${response.status})`);
  return response.json();
}

export async function loadCities(): Promise<CitySummary[]> {
  return parseCities(await fetchJson('cities.json'));
}

export async function loadCity(id: string): Promise<CityDetail> {
  return parseCityDetail(await fetchJson(`${encodeURIComponent(id)}.json`));
}
