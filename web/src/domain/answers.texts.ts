import { texts } from '../i18n/locale';
import { pluralEn, pluralRu } from '../i18n/plural';
import { genitive } from '../i18n/russian';
import { causeClause, causeSubject, type CauseWords } from './causes';
import { capitalize, type Phrase, type Span } from './phrase';

/** One cause in a sentence: its words and its contribution, °C (the sign picks "heats" or "cools"). */
interface Cause {
  words: CauseWords;
  value: number;
}

export const ANSWER_TEXTS = texts(
  {
    island: {
      same: (city: string): Phrase => [`Within ${city}, the surface is as warm as around the city.`],
      hotter: (city: string, deg: Span): Phrase => [`Within ${city}, the surface is `, deg, ' hotter than around the city.'],
      cooler: (city: string, deg: Span): Phrase => [
        `Within ${city}, the surface is `,
        deg,
        ' cooler than around the city: bare ground outside the city line heats up more than the city does.',
      ],
    },
    pattern: {
      open: (built: string, builtGap: string, bare: { share: string; gap: string } | null, outside: string | null) =>
        ` These are mostly open, little-built places: ${built} built up (${builtGap})` +
        (bare ? `, ${bare.share} bare ground (${bare.gap})` : '') +
        '.' +
        (outside ? ` ${outside} of them lie outside the city line.` : ''),
      denseBare: (built: string, builtGap: string, bare: string, bareGap: string) =>
        ` There, dense building is mixed with bare ground: ${built} built up (${builtGap}), ${bare} bare ground (${bareGap}).`,
      dense: (built: string, gap: string) => ` This is dense building: ${built} built up, ${gap} above the average.`,
      bare: (bare: string, gap: string) => ` There is a lot of bare ground: ${bare}, ${gap} above the average.`,
      gap: (points: string) => `${points} pp`,
    },
    hotTenth: {
      head: (threshold: Span): Phrase => ['One in ten 200 m cells is hotter than ', threshold, '.'],
      cause: (there: string, share: string, second: { there: string; share: string } | null) =>
        ` What the model ties to the heat there most often: ${there}, in ${share} of them` +
        (second ? `; second, ${second.there} (${second.share})` : '') +
        '.',
    },
    place: {
      nearMean: 'About the city average.',
      nearMeanCause: ({ words, value }: Cause) => ` The largest effect: ${causeSubject(words, value)}.`,
      hotter: (deg: Span): Phrase => [deg, ' hotter than the city average.'],
      hotterCause: ({ words, value }: Cause, almostAll: boolean) =>
        ` ${almostAll ? 'Almost all of it' : 'The largest share'} comes from ${causeSubject(words, value)}.`,
      cooler: (deg: Span): Phrase => [deg, ' cooler than the city average.'],
      coolerCause: ({ words, value }: Cause) => ` Most of the cooling comes from ${causeSubject(words, value)}.`,
    },
    section: {
      missed: 'The section misses the data.',
      allCool: 'The whole section is cooler than the city average.',
      allCoolCause: ({ words, value }: Cause) => ` Most of the cooling comes from ${causeSubject(words, value)}.`,
      allHot: (length: string, peak: Span): Phrase => [`The whole section, ${length}, is hotter than average, by up to `, peak, '.'],
      partHot: (hot: string, inside: string, peak: Span): Phrase => [`${hot} of ${inside} is hotter than average, by up to `, peak, '.'],
      hotCause: ({ words, value }: Cause) => ` Most of the heat there comes from ${causeSubject(words, value)}.`,
    },
    rest: (count: number, sum: string) => `${count} more ${pluralEn(count, ['cause', 'causes'])} · ${sum}`,
    advice: {
      whereHotspot: 'In the hottest tenth',
      whereHere: 'Here',
      reason: (where: string, measure: string, deg: Span): Phrase => [`${where}: ${measure}; in the model this adds `, deg, '.'],
      nothingHotspot: 'Nothing to change.',
      nothingCool: 'Cooler than average here, nothing to change.',
      keep: (head: string, cools: string, deg: Span): Phrase => [`${head} Worth keeping what cools it: ${cools}, `, deg, '.'],
      noHeat: 'No factor heats this place noticeably; there is no clear measure.',
      notLever: (words: CauseWords, deg: Span): Phrase => [
        `${capitalize(words.heats)} adds `,
        deg,
        words.explain ? ` here. ${words.explain}` : ' here, and landscaping cannot change that.',
      ],
      noClear: (heats: string) => `No clear measure: ${heats} here is no worse than the city average.`,
    },
    sources: (sources: string, period: string, r2: string, error: string) =>
      `${sources}, ${period}. R² ${r2} on spatial cross-validation, error ~${error}. ` +
      'Factor contributions show association, not cause and effect.',
  },
  {
    island: {
      same: (city) => [`В черте ${genitive(city)} поверхность такая же, как вокруг.`],
      hotter: (city, deg) => [`В черте ${genitive(city)} поверхность на `, deg, ' горячее, чем вокруг.'],
      cooler: (city, deg) => [
        `В черте ${genitive(city)} поверхность на `,
        deg,
        ' прохладнее, чем вокруг: голая земля за чертой нагревается сильнее города.',
      ],
    },
    pattern: {
      open: (built, builtGap, bare, outside) =>
        ` Это в основном открытые, мало застроенные места: застроено ${built} (${builtGap})` +
        (bare ? `, голой земли ${bare.share} (${bare.gap})` : '') +
        '.' +
        (outside ? ` ${capitalize(outside)} из них за городской чертой.` : ''),
      denseBare: (built, builtGap, bare, bareGap) =>
        ` Там плотная застройка вперемешку с голой землёй: застроено ${built} (${builtGap}), голой земли ${bare} (${bareGap}).`,
      dense: (built, gap) => ` Это плотная застройка: застроено ${built}, на ${gap} больше среднего.`,
      bare: (bare, gap) => ` Там много голой земли: ${bare}, на ${gap} больше среднего.`,
      gap: (points) => `${points} п.п.`,
    },
    hotTenth: {
      head: (threshold) => ['Каждый десятый участок 200 м горячее ', threshold, '.'],
      cause: (there, share, second) =>
        ` Сильнее всего с жарой там по модели связано: ${there}, так в ${share} из них` +
        (second ? `; на втором месте ${second.there} (${second.share})` : '') +
        '.',
    },
    place: {
      nearMean: 'Почти как в среднем по городу.',
      nearMeanCause: ({ words, value }) => ` Сильнее всего ${causeClause(words, value, { one: 'влияет', many: 'влияют' })}.`,
      hotter: (deg) => ['На ', deg, ' жарче, чем в среднем по городу.'],
      hotterCause: ({ words, value }, almostAll) =>
        ` ${almostAll ? 'Почти всё это' : 'Больше всего'} ${causeClause(words, value, { one: 'даёт', many: 'дают' })}.`,
      cooler: (deg) => ['На ', deg, ' прохладнее, чем в среднем по городу.'],
      coolerCause: ({ words, value }) => ` Больше всего ${causeClause(words, value, { one: 'охлаждает', many: 'охлаждают' })}.`,
    },
    section: {
      missed: 'Разрез прошёл мимо данных.',
      allCool: 'Весь разрез прохладнее, чем в среднем по городу.',
      allCoolCause: ({ words, value }) => ` Больше всего ${causeClause(words, value, { one: 'охлаждает', many: 'охлаждают' })}.`,
      allHot: (length, peak) => [`Весь разрез, ${length}, жарче среднего, до `, peak, '.'],
      partHot: (hot, inside, peak) => [`Жарче среднего ${hot} из ${inside}, до `, peak, '.'],
      hotCause: ({ words, value }) => ` Там больше всего ${causeClause(words, value, { one: 'греет', many: 'греют' })}.`,
    },
    rest: (count, sum) => `ещё ${count} ${pluralRu(count, ['причина', 'причины', 'причин'])} · ${sum}`,
    advice: {
      whereHotspot: 'В горячей десятой части',
      whereHere: 'Здесь',
      reason: (where, measure, deg) => [`${where} ${measure}, по модели это даёт `, deg, '.'],
      nothingHotspot: 'Менять нечего.',
      nothingCool: 'Здесь прохладнее среднего, менять нечего.',
      keep: (head, cools, deg) => [`${head} Стоит сохранить то, что охлаждает: ${cools}, `, deg, '.'],
      noHeat: 'Ни один фактор не греет это место заметно, явной меры нет.',
      notLever: (words, deg) => [
        `${capitalize(words.heats)} ${words.plural ? 'добавляют' : 'добавляет'} здесь `,
        deg,
        words.explain ? `. ${words.explain}` : ', а это благоустройством не изменить.',
      ],
      noClear: (heats) => `Явной меры нет: ${heats} здесь не хуже, чем в среднем по городу.`,
    },
    sources: (sources, period, r2, error) =>
      `${sources}, ${period}. R² ${r2} на пространственной проверке, ошибка ~${error}. ` + 'Вклад факторов показывает связь, а не эксперимент.',
  },
);
