import type { CitySummary, FeatureMeta, SurfaceMaterial } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { unitText } from './format';

/**
 * The data files are written in Russian (labels, descriptions, periods, district names); the cities carry `nameEn`. Their English lives here,
 * keyed by the fixed vocabulary of the contract; anything outside it is shown as the data has it.
 */

const FEATURES_EN: Record<string, { label: string; description: string }> = {
  ndvi: { label: 'Vegetation', description: 'Vegetation index from Sentinel-2, summer median. Higher means more green.' },
  tree: { label: 'Tree cover', description: 'Share of the cell under trees, ESA WorldCover 2021.' },
  built: { label: 'Built-up', description: 'Share of the cell under buildings and paving, ESA WorldCover 2021.' },
  bare: { label: 'Bare ground', description: 'Share of the cell with neither plants nor buildings, ESA WorldCover 2021.' },
  albedo: { label: 'Albedo', description: 'Share of sunlight the surface reflects, Sentinel-2, Liang (2001) formula.' },
  roads: { label: 'Road density', description: 'Length of roads per km², OpenStreetMap.' },
  buildings: { label: 'Building density', description: 'Buildings per hectare, OpenStreetMap.' },
  height: {
    label: 'Building height',
    description: 'Mean building height in the cell: OpenStreetMap (height, or floors × 3 m), else GHSL Built-H 2018.',
  },
  volume: {
    label: 'Building volume',
    description: 'Building volume per hectare: the area under buildings from GHSL Built-S 2020 times their height.',
  },
  water_dist: { label: 'Distance to water', description: 'Mean distance to water: water bodies from ESA WorldCover, rivers and canals from OpenStreetMap.' },
  elevation: { label: 'Elevation', description: 'Height above sea level, Copernicus DEM GLO-30.' },
};

const SURFACES_EN: Record<string, string> = {
  asphalt: 'Asphalt',
  concrete: 'Concrete',
  dry_soil: 'Dry soil',
  wet_soil: 'Wet soil',
};

/** Tashkent's districts as the data names them, and their usual English names. */
const DISTRICTS_EN: Record<string, string> = {
  'Алмазарский район': 'Olmazor district',
  'Бектемирский район': 'Bektemir district',
  'Бектимирский район': 'Bektemir district',
  'Мирабадский район': 'Mirobod district',
  'Мирзо-Улугбекский район': 'Mirzo Ulugbek district',
  'Сергелийский район': 'Sergeli district',
  'Учтепинский район': 'Uchtepa district',
  'Чиланзарский район': 'Chilonzor district',
  'Шайхантахурский район': 'Shaykhontohur district',
  'Юнусабадский район': 'Yunusobod district',
  'Яккасарайский район': 'Yakkasaroy district',
  'Янгихаётский район': 'Yangihayot district',
  'Янгиташкентский район': 'Yangi Toshkent district',
  'Яшнабадский район': 'Yashnobod district',
};

const MONTHS_EN: ReadonlyArray<readonly [RegExp, string]> = [
  [/январ[ья]/g, 'January'],
  [/феврал[ья]/g, 'February'],
  [/марта?/g, 'March'],
  [/апрел[ья]/g, 'April'],
  [/ма[йя]/g, 'May'],
  [/июн[ья]/g, 'June'],
  [/июл[ья]/g, 'July'],
  [/августа?/g, 'August'],
  [/сентябр[ья]/g, 'September'],
  [/октябр[ья]/g, 'October'],
  [/ноябр[ья]/g, 'November'],
  [/декабр[ья]/g, 'December'],
];

export const cityName = (city: Pick<CitySummary, 'name' | 'nameEn'>, locale: Locale): string =>
  locale === 'en' && city.nameEn ? city.nameEn : city.name;

export const featureLabel = (feature: Pick<FeatureMeta, 'key' | 'label'>, locale: Locale): string =>
  locale === 'en' ? (FEATURES_EN[feature.key]?.label ?? feature.label) : feature.label;

export const featureDescription = (feature: Pick<FeatureMeta, 'key' | 'description'>, locale: Locale): string =>
  locale === 'en' ? (FEATURES_EN[feature.key]?.description ?? feature.description) : feature.description;

export const featureUnit = (feature: Pick<FeatureMeta, 'unit'>, locale: Locale): string => unitText(feature.unit, locale);

export const surfaceLabel = (surface: Pick<SurfaceMaterial, 'key' | 'label'>, locale: Locale): string =>
  locale === 'en' ? (SURFACES_EN[surface.key] ?? surface.label) : surface.label;

export const districtName = (name: string, locale: Locale): string => (locale === 'en' ? (DISTRICTS_EN[name] ?? name) : name);

/** "июнь–август 2023–2025" → "June–August 2023–2025". */
export const periodText = (label: string, locale: Locale): string =>
  locale === 'en' ? MONTHS_EN.reduce((text, [pattern, month]) => text.replace(pattern, month), label) : label;
