import { describe, expect, it } from 'vitest';
import type { CityDetail, FeatureMeta } from '../data/contract';
import { advise, cityAnswer, cityFacts, dominantFor, genitive, placeAnswer, plainText, restOfCauses, sectionAnswer, sourcesLine } from './answers';
import { cityFactorMeans, hotspotProfile, type PlaceProfile } from './places';
import type { Profile, Sample } from './transect';

/** Formatting uses non-breaking spaces; compare with plain ones for readability. */
const plain = (text: string) => text.replace(/[  ]/g, ' ');
const say = (phrase: Parameters<typeof plainText>[0]) => plain(plainText(phrase));

const feature = (key: string, label: string, unit: string): FeatureMeta => ({ key, label, unit, description: '' });
const FEATURES = [feature('ndvi', 'Растительность', 'NDVI'), feature('built', 'Застройка', '% площади'), feature('elevation', 'Высота', 'м')];

/** Ten cells: the two hottest are bare of green; the coolest are green. */
function city(): CityDetail {
  const lst = [38, 39, 40, 41, 42, 43, 44, 45, 50, 52];
  const ndvi = [0.6, 0.5, 0.45, 0.4, 0.3, 0.3, 0.25, 0.2, 0.08, 0.05];
  return {
    city: { id: 'tashkent', name: 'Ташкент', nameEn: 'Tashkent', country: 'Узбекистан', center: [0, 0], bbox: [0, 0, 1, 1], lstMean: 43.4, r2: 0.74 },
    period: { label: 'июнь–август 2023–2025', lstScenes: 9, s2Scenes: 6 },
    grid: { cellSizeM: 200, halfSizeDeg: [0.001, 0.001], count: 10 },
    features: FEATURES,
    model: { type: 'XGBoost', r2Cv: 0.743, maeCv: 1.297, cv: 'spatial', baseValue: 43.4 },
    stats: { lstMean: 43.4, lstMin: 38, lstMax: 52, lstP10: 38.9, lstP90: 50.2 },
    globalImportance: [],
    cells: {
      lon: lst.map((_, i) => i),
      lat: lst.map(() => 0),
      lst,
      values: { ndvi, built: lst.map((t) => t), elevation: lst.map(() => 450) },
      shap: {
        ndvi: ndvi.map((v) => (0.3 - v) * 12),
        built: lst.map(() => 0.2),
        elevation: lst.map(() => 0.1),
      },
    },
    districts: [],
  };
}

const place = (lst: number, contributions: Record<string, number>, values: Record<string, number> = {}): PlaceProfile => ({
  kind: 'cell',
  cell: 0,
  lst,
  cellCount: 1,
  values,
  contributions,
});

describe('genitive', () => {
  it.each([
    ['Ташкент', 'Ташкента'],
    ['Самарканд', 'Самарканда'],
    ['Бухара', 'Бухары'],
    ['Фергана', 'Ферганы'],
    ['Карши', 'Карши'],
  ])('%s → %s', (name, expected) => expect(genitive(name)).toBe(expected));
});

describe('cityAnswer', () => {
  it('names the hottest tenth and its usual cause, in two short sentences', () => {
    const detail = city();
    const facts = cityFacts(detail, hotspotProfile(detail));
    expect(facts.topKey).toBe('ndvi');
    expect(say(cityAnswer(detail, facts))).toBe('Каждый десятый квартал Ташкента горячее 50,2°. Почти всегда там мало зелени.');
  });

  it('stops after the first sentence when nothing heats the hottest tenth', () => {
    expect(say(cityAnswer(city(), { topKey: null, topShare: 0 }))).toBe('Каждый десятый квартал Ташкента горячее 50,2°.');
  });

  it('never uses an em-dash', () => {
    const detail = city();
    expect(plainText(cityAnswer(detail, cityFacts(detail, hotspotProfile(detail))))).not.toContain('—');
  });
});

describe('placeAnswer', () => {
  it('says how much hotter, and what gives almost all of it', () => {
    expect(say(placeAnswer(place(50, { ndvi: 5, built: 1 }), 43.4, FEATURES))).toBe(
      'На 6,6° жарче, чем в среднем по городу. Почти всё это даёт нехватка зелени.',
    );
  });

  it('says "больше всего" when the top cause explains only part of it', () => {
    expect(say(placeAnswer(place(50, { ndvi: 2, built: 1.8 }), 43.4, FEATURES))).toContain('Больше всего даёт нехватка зелени.');
  });

  it('names what cools a cool place', () => {
    expect(say(placeAnswer(place(40, { ndvi: -3, built: 0.4 }), 43.4, FEATURES))).toBe(
      'На 3,4° прохладнее, чем в среднем по городу. Больше всего охлаждает зелень.',
    );
  });

  it('calls a near-average place average', () => {
    expect(say(placeAnswer(place(43.6, { ndvi: -0.2, built: 0.9 }), 43.4, FEATURES))).toBe(
      'Почти как в среднем по городу. Сильнее всего влияет плотная застройка.',
    );
  });

  it('marks the difference as a hot number', () => {
    const [, number] = placeAnswer(place(50, { ndvi: 5 }), 43.4, FEATURES);
    expect(number).toMatchObject({ tone: 'hot' });
  });
});

describe('dominantFor and restOfCauses', () => {
  it('shows what heats a hot place and folds the rest into one signed line', () => {
    const hot = place(50, { ndvi: 4.6, built: 1.2, elevation: -0.5 });
    expect(dominantFor(hot, 43.4)).toEqual(['ndvi', 4.6]);
    const rest = restOfCauses(hot.contributions, 'ndvi');
    expect(rest.count).toBe(2);
    expect(plain(rest.summary)).toBe('ещё 2 причины · +0,7°');
  });

  it('shows what cools a cool place', () => {
    expect(dominantFor(place(40, { ndvi: -3, built: 0.4 }), 43.4)).toEqual(['ndvi', -3]);
  });
});

describe('advise', () => {
  it('ties the measure to the cause and backs it with a cooler peer group', () => {
    const detail = city();
    const advice = advise(detail, place(52, { ndvi: 3, built: 0.2, elevation: 0.1 }, { ndvi: 0.05, built: 52, elevation: 450 }), cityFactorMeans(detail));
    expect(advice.kind).toBe('act');
    if (advice.kind !== 'act') return;
    expect(advice.title).toBe('Деревья вдоль улиц и теневые навесы');
    expect(say(advice.reason)).toMatch(/^Здесь NDVI 0,05\. Где NDVI выше 0,\d\d \(\d+ % города\), поверхность в среднем \d+,\d°, на \d+,\d° прохладнее\.$/);
    expect(plain(advice.effect)).toMatch(/^Обычно это снимает /);
  });

  it('does not claim that green cools a cool place unless green is what cools it', () => {
    const detail = city();
    const cooledByElevation = place(40, { ndvi: 0.1, built: 0.1, elevation: -2 }, { ndvi: 0.3, built: 40, elevation: 450 });
    const advice = advise(detail, cooledByElevation, cityFactorMeans(detail));
    expect(advice.kind).toBe('none');
    expect(say(advice.kind === 'none' ? advice.text : [])).toBe('Здесь прохладнее среднего, менять нечего.');
  });

  it('names what to keep when an actionable factor cools the place', () => {
    const detail = city();
    const advice = advise(detail, place(40, { ndvi: -3, built: 0.1 }, { ndvi: 0.6, built: 40 }), cityFactorMeans(detail));
    expect(say(advice.kind === 'none' ? advice.text : [])).toBe('Здесь прохладнее среднего, менять нечего. Стоит сохранить то, что охлаждает: зелень, −3,0°.');
  });

  it('says plainly when the heat comes from something no measure changes', () => {
    const detail = city();
    const advice = advise(detail, place(46, { ndvi: -0.2, built: 0.05, elevation: 1.4 }, { ndvi: 0.4, built: 40, elevation: 450 }), cityFactorMeans(detail));
    expect(say(advice.kind === 'none' ? advice.text : [])).toBe('Рельеф добавляет здесь +1,4°, а это благоустройством не изменить.');
  });
});

describe('sectionAnswer', () => {
  const sample = (d: number, t: number, contributions: Record<string, number> | null): Sample => ({
    d,
    point: [d, 0],
    cell: contributions ? 1 : -1,
    inside: contributions !== null,
    t,
    contributions,
    cause: null,
  });
  const profile = (samples: Sample[]): Profile => ({ length: samples[samples.length - 1]?.d ?? 0, samples, segments: [] });

  it('says how much of the line is hot, how hot it peaks and what heats it', () => {
    const p = profile([0, 1000, 2000, 3000, 4000].map((d, i) => sample(d, i < 2 ? 40 : 48, i < 2 ? { ndvi: -1 } : { ndvi: 3, built: 1 })));
    expect(say(sectionAnswer(p, 43.4, FEATURES))).toBe('Жарче среднего 2,4 км из 4,0 км, до +4,6°. Там больше всего греет нехватка зелени.');
  });

  it('handles a line that is cool all along', () => {
    const p = profile([0, 1000, 2000, 3000].map((d) => sample(d, 40, { ndvi: -2, built: 0.3 })));
    expect(say(sectionAnswer(p, 43.4, FEATURES))).toBe('Весь разрез прохладнее, чем в среднем по городу. Больше всего охлаждает зелень.');
  });

  it('handles a line that misses the data', () => {
    expect(say(sectionAnswer(profile([sample(0, 40, null), sample(10, 40, null)]), 43.4, FEATURES))).toBe('Разрез прошёл мимо данных.');
  });
});

describe('sourcesLine', () => {
  it('lists only the sources behind the factors present, and the model quality from the data', () => {
    expect(plain(sourcesLine(city()))).toBe(
      'Landsat 8/9, Sentinel-2, ESA WorldCover, Copernicus DEM, июнь–август 2023–2025. R² 0,74 на пространственной проверке, ошибка ~1,3°. Вклад факторов показывает связь, а не эксперимент.',
    );
  });
});
