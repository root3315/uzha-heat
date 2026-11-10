import { advise, capitalize, cityAnswer, dominantFor, placeAnswer, restOfCauses, type Advice, type Phrase } from '../domain/answers';
import { causeLabel, causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import { cellFluxes, energyView, meanFluxes, type EnergyView } from '../domain/energy';
import { formatDeg, formatFactorValue } from '../domain/format';
import { hottestTenth, type PlaceProfile } from '../domain/places';
import { siteNote, siteTitle, type Site } from '../domain/sites';

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
}

/**
 * Everything the panel says, for the whole city (`place` null) or one picked place.
 * On an airfield or a rail yard the place is named for what it is, and no street measure is offered.
 */
export function panelContent(model: CityModel, place: PlaceProfile | null, placeTitle: string, site: Site | null = null): PanelContent {
  const { detail } = model;
  const { stats, features } = detail;
  const subject = place ?? model.hotspot;
  const featureByKey = new Map(features.map((f) => [f.key, f]));

  const dominant = dominantFor(subject, stats.lstMean);
  let cause: PanelContent['cause'] = null;
  let rest: PanelContent['rest'] = null;
  if (dominant) {
    const [key, value] = dominant;
    const feature = featureByKey.get(key);
    const words = causeWords(feature ?? { key, label: key, unit: '' });
    const here = words.measure(subject.values[key] ?? Number.NaN);
    const cityMean = model.cityMeans[key];
    const note =
      (place ? here : `в горячей десятой части ${here}`) +
      (feature && cityMean !== undefined ? `, в среднем по городу ${formatFactorValue(feature, cityMean)}` : '');
    cause = { key, value, label: capitalize(value >= 0 ? words.heats : words.cools), note };
    const others = Object.entries(subject.contributions)
      .filter(([k]) => k !== key)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([k, v]) => ({ key: k, value: v, label: causeLabel(causeWords(featureByKey.get(k) ?? { key: k, label: k, unit: '' }), v) }));
    if (others.length) rest = { summary: restOfCauses(subject.contributions, key).summary, rows: others };
  }

  const fluxes = place?.cell !== undefined ? cellFluxes(detail, place.cell) : meanFluxes(detail, hottestTenth(detail));
  const energy = energyView(detail, fluxes, subject.values);

  return {
    title: place ? (site ? siteTitle(site) : placeTitle) : detail.city.name,
    isCity: place === null,
    answer: place ? placeAnswer(place, stats.lstMean, features) : cityAnswer(detail, model.facts),
    figure: place ? place.lst : stats.lstMean,
    figureCaption: place ? `здесь, в среднем по городу ${formatDeg(stats.lstMean)}` : `в среднем по городу, от ${formatDeg(stats.lstMin, 0)} до ${formatDeg(stats.lstMax, 0)}`,
    meanMark: place ? stats.lstMean : null,
    cause,
    rest,
    advice: place && site ? { kind: 'none', text: [siteNote(site)] } : advise(detail, subject, model.cityMeans),
    energy: energy && { title: place ? 'Физика участка' : 'Физика горячей десятой части', view: energy },
  };
}
