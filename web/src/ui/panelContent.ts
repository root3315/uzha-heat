import { advise, capitalize, cityAnswer, dominantFor, placeAnswer, restOfCauses, type Advice, type Phrase } from '../domain/answers';
import { causeLabel, causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import { formatDeg, formatFactorValue } from '../domain/format';
import type { PlaceProfile } from '../domain/places';

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
}

/** Everything the panel says, for the whole city (`place` null) or one picked place. */
export function panelContent(model: CityModel, place: PlaceProfile | null, placeTitle: string): PanelContent {
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

  return {
    title: place ? placeTitle : detail.city.name,
    isCity: place === null,
    answer: place ? placeAnswer(place, stats.lstMean, features) : cityAnswer(detail, model.facts),
    figure: place ? place.lst : stats.lstMean,
    figureCaption: place ? `здесь, в среднем по городу ${formatDeg(stats.lstMean)}` : `в среднем по городу, от ${formatDeg(stats.lstMin, 0)} до ${formatDeg(stats.lstMax, 0)}`,
    meanMark: place ? stats.lstMean : null,
    cause,
    rest,
    advice: advise(detail, subject, model.cityMeans),
  };
}
