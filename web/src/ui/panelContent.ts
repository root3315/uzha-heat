import { advise, cityAnswer, dominantFor, isNegligible, placeAnswer, restOfCauses, type Advice } from '../domain/answers';
import { causeLabel, causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import { cityName } from '../domain/dataTexts';
import { cellFluxes, energyView, meanFluxes, type EnergyView } from '../domain/energy';
import { formats } from '../domain/format';
import { capitalize, type Phrase } from '../domain/phrase';
import { hottestTenth, type PlaceProfile } from '../domain/places';
import { siteNote, siteTitle, type Site } from '../domain/sites';
import type { Locale } from '../i18n/locale';
import { PANEL_TEXTS } from './ui.texts';

export interface CauseRow {
  key: string;
  label: string;
  value: number;
}

export interface PanelContent {
  title: string;
  /** The whole city: its name is already on the switcher above, so the title stays for screen readers only. */
  isCity: boolean;
  answer: Phrase;
  figure: number;
  figureCaption: string;
  /** City mean, marked on the ramp next to a single place. */
  meanMark: number | null;
  cause: (CauseRow & { note: string }) | null;
  rest: { summary: string; rows: CauseRow[] } | null;
  advice: Advice;
  /** Where the sunlight goes: the picked cell, or the hottest tenth for the city. Null without energy data. */
  energy: { title: string; view: EnergyView } | null;
  /** The picked cell for "what if"; null for the whole city and on an airfield or a rail yard. */
  whatIfCell: number | null;
}

/**
 * Everything the panel says, for the whole city (`place` null) or one picked place.
 * On an airfield or a rail yard the place is named for what it is, and no street measure is offered.
 */
export function panelContent(model: CityModel, place: PlaceProfile | null, placeTitle: string, site: Site | null, locale: Locale): PanelContent {
  const t = PANEL_TEXTS[locale];
  const { formatDeg, formatFactorValue } = formats(locale);
  const { detail } = model;
  const { stats, features } = detail;
  const subject = place ?? model.hotspot;
  const featureByKey = new Map(features.map((f) => [f.key, f]));
  const wordsFor = (key: string) => causeWords(featureByKey.get(key) ?? { key, label: key, unit: '' }, locale);

  const dominant = dominantFor(subject, stats.lstMean);
  let cause: PanelContent['cause'] = null;
  let rest: PanelContent['rest'] = null;
  if (dominant) {
    const [key, value] = dominant;
    const feature = featureByKey.get(key);
    const words = wordsFor(key);
    const here = words.measure(subject.values[key] ?? Number.NaN);
    const cityMean = model.cityMeans[key];
    const note = (place ? here : t.inHottestTenth(here)) + (feature && cityMean !== undefined ? t.cityMean(formatFactorValue(feature, cityMean)) : '');
    cause = { key, value, label: capitalize(value >= 0 ? words.heats : words.cools), note };
    const others = Object.entries(subject.contributions)
      .filter(([k, v]) => k !== key && !isNegligible(v))
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, v]) => ({ key: k, value: v, label: causeLabel(wordsFor(k), v) }));
    if (others.length) rest = { summary: restOfCauses(subject.contributions, key, locale).summary, rows: others };
  }

  const fluxes = place?.cell !== undefined ? cellFluxes(detail, place.cell) : meanFluxes(detail, hottestTenth(detail));
  const energy = energyView(detail, fluxes, subject.values, locale);

  return {
    title: place ? (site ? siteTitle(site, locale) : placeTitle) : cityName(detail.city, locale),
    isCity: place === null,
    answer: place ? placeAnswer(place, stats.lstMean, features, locale) : cityAnswer(detail, model.facts, locale),
    figure: place ? place.lst : stats.lstMean,
    figureCaption: place ? t.figureHere(formatDeg(stats.lstMean)) : t.figureCity(formatDeg(stats.lstMin, 0), formatDeg(stats.lstMax, 0)),
    meanMark: place ? stats.lstMean : null,
    cause,
    rest,
    advice: place && site ? { kind: 'none', text: [siteNote(site, locale)] } : advise(detail, subject, model.cityMeans, locale),
    energy: energy && { title: place ? t.energyPlace : t.energyHot, view: energy },
    whatIfCell: place?.cell !== undefined && !site ? place.cell : null,
  };
}
