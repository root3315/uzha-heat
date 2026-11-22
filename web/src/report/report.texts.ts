import { texts } from '../i18n/locale';
import { pluralEn, pluralRu } from '../i18n/plural';
import { genitive } from '../i18n/russian';

const NBSP = ' ';

export const REPORT_TEXTS = texts(
  {
    dateLocale: 'en-GB',
    unnamed: 'Unnamed cell',
    coords: (lat: string, lon: string) => `${lat}° N, ${lon}° E`,
    noHousing: 'almost no housing on the cell',
    lives: (people: string) => `~${people} live here`,
    near: (metres: number) => `Nearby, within ${metres} m`,
    andMore: (count: string) => `and ${count} more`,
    cells: (count: number, figure: string) => `${figure} ${pluralEn(count, ['cell', 'cells'])}`,
    dialog: (city: string) => `Report: ${city}`,
    printLong: 'Print or save as PDF',
    printShort: 'Save PDF',
    close: 'Close',
    kicker: 'UzHa · report',
    subtitle: `Where the surface overheats in summer, and${NBSP}why`,
    meta: (period: string, size: number) => `Landsat imagery, ${period} · ${size}${NBSP}×${NBSP}${size}${NBSP}m cells · `,
    parts: {
      main: 'Summary',
      figures: 'Key figures',
      place: (title: string) => `Selected place: ${title}`,
      hottest: 'Hottest places',
      crowded: 'Where most people live in the heat',
      causes: 'What heats the hottest 10% of the city',
      physics: 'Physics: where the sunlight goes',
      measures: 'What to do',
      map: 'Map and section',
      cities: 'Other cities',
      method: 'How it was calculated, and what the map does not know',
    },
    island: (inside: string, insideT: string, outside: string, outsideT: string) =>
      ` This is the heat island: the median surface temperature of ${inside} inside the city line, ${insideT}, ` +
      `minus the median of ${outside} in the ring around it, ${outsideT}.`,
    peopleInHeat: (share: string, note: string) =>
      ` inside the city line live on the hottest cells, ${share} of its residents. ${note}`,
    figures: {
      mean: 'city average',
      hot: 'hottest 10% of the city, from',
      cool: 'coolest 10% of the city, up to',
      spread: 'spread between them',
    },
    scale: (min: string, max: string) =>
      `Scale: share of the city's area in each temperature class, from${NBSP}${min} to${NBSP}${max}, with the mean marked. ` +
      `This is surface temperature, not${NBSP}air.`,
    hottestLead: (size: number) =>
      `The five hottest ${size}${NBSP}m cells inside the city line, at least 1.5${NBSP}km apart. ` +
      'Cause: the factor that, in the model, heats the cell most.',
    vsMean: `vs${NBSP}the mean`,
    crowdedLead: (metres: number) =>
      `Cells of the hottest 10% of the city where the most people live, at least 1${NBSP}km apart. ` +
      `Nearby: schools, kindergartens and clinics within${NBSP}${metres}${NBSP}m, from${NBSP}OpenStreetMap.`,
    causesLead: (count: number, figure: string, threshold: string, mean: string) =>
      `${figure} ${pluralEn(count, ['cell is', 'cells are'])} hotter than ${threshold}, ${mean} on${NBSP}average. ` +
      `Bar: how many degrees the factor adds there on average, by the model; below it: the factor's value and the share of cells where it${NBSP}leads.`,
    leads: (share: string) => ` · leads in ${share}`,
    physicsNote: (caveat: string) =>
      `Bar: where the solar energy left after the surface's own thermal radiation goes, averaged over cells. ${caveat}`,
    measuresLead: (city: string) =>
      `Measures for the hottest 10% of ${city}, by${NBSP}what heats it. How much a measure removes is known from reviews of${NBSP}other ` +
      `cities; each has its${NBSP}reference.`,
    byModel: `; in${NBSP}the model this is `,
    mapAlt: (city: string, a: string, b: string) => `Surface isotherms: ${city}, section line from ${a} to ${b}`,
    mapFailed: 'The map did not render; the section is below.',
    mapDrawing: 'Drawing the map…',
    mapCaption: (step: string, a: string, b: string, length: string) =>
      `Surface isotherms every ${step}°, colour: temperature class. Line ${a}–${b}: a section ${length} long.`,
    sectionNote: `Band under the curve: what changes the temperature most on${NBSP}each stretch.`,
    table: { city: 'City', island: 'Heat island', mean: 'Mean', hot: 'Hottest 1/10', from: (t: string) => `from ${t}` },
    tableNote:
      `Heat island: the surface inside the city line against the ring around it. R²: the share of temperature differences the model ` +
      `explains on parts of the city it has${NBSP}not seen.`,
    weather: 'Summer weather',
    method: (city: string, count: string, size: number, scenes: number, model: string, factors: number) =>
      `${city} is divided into${NBSP}${count} cells of ${size}${NBSP}×${NBSP}${size}${NBSP}m. Surface temperature: the median of ${scenes} ` +
      `cloud-free Landsat 8/9 ${pluralEn(scenes, ['scene', 'scenes'])}. The ${model} model predicts it from${NBSP}${factors} factors; ` +
      `SHAP gives each factor's contribution in${NBSP}degrees.`,
    limits: [
      `This is surface temperature, not${NBSP}air. By day it is higher and changes more${NBSP}sharply.`,
      `Landsat passes over at about 11 a.m. Evening and night overheating does not${NBSP}show here.`,
      `A factor's contribution shows an association in${NBSP}the data, not${NBSP}an experiment. Where there is little greenery, buildings are usually denser.`,
      `The effect of measures comes from reviews of${NBSP}other cities: a guide, not${NBSP}a forecast for the cell.`,
    ],
    popLimit: (caveat: string) => `${caveat} It shows where people live, not${NBSP}where they are during the day.`,
    basemap: ' Basemap: © OpenStreetMap, OpenFreeMap.',
  },
  {
    dateLocale: 'ru-RU',
    unnamed: 'Участок без названия',
    coords: (lat, lon) => `${lat}° с.ш., ${lon}° в.д.`,
    noHousing: 'жилья на участке почти нет',
    lives: (people) => `живёт ~${people}`,
    near: (metres) => `Рядом, до ${metres} м`,
    andMore: (count) => `и ещё ${count}`,
    cells: (count, figure) => `${figure} ${pluralRu(count, ['участка', 'участков', 'участков'])}`,
    dialog: (city) => `Отчёт: ${city}`,
    printLong: 'Распечатать или сохранить в PDF',
    printShort: 'Сохранить PDF',
    close: 'Закрыть',
    kicker: 'UzHa · отчёт',
    subtitle: `Где поверхность перегревается летом и${NBSP}почему`,
    meta: (period, size) => `Снимки Landsat, ${period} · участки ${size}${NBSP}×${NBSP}${size}${NBSP}м · `,
    parts: {
      main: 'Главное',
      figures: 'Ключевые цифры',
      place: (title) => `Выбранное место: ${title}`,
      hottest: 'Самые горячие места',
      crowded: 'Где в жаре живёт больше всего людей',
      causes: 'Что греет самые горячие 10 % города',
      physics: 'Физика: куда уходит солнце',
      measures: 'Что делать',
      map: 'Карта и разрез',
      cities: 'Города рядом',
      method: 'Как посчитано и чего карта не знает',
    },
    island: (inside, insideT, outside, outsideT) =>
      ` Это остров тепла: медиана температуры поверхности ${inside} внутри черты города, ${insideT}, ` +
      `минус медиана ${outside} в${NBSP}кольце вокруг, ${outsideT}.`,
    peopleInHeat: (share, note) => ` в${NBSP}черте города живут на${NBSP}самых горячих участках, это ${share} его жителей. ${note}`,
    figures: {
      mean: 'в среднем по городу',
      hot: 'самые горячие 10 % города, от',
      cool: 'самые прохладные 10 % города, до',
      spread: 'разброс между ними',
    },
    scale: (min, max) =>
      `Шкала: доля площади города в${NBSP}каждом классе температуры, от${NBSP}${min} до${NBSP}${max}, отмечено среднее. ` +
      `Это температура поверхности, а${NBSP}не${NBSP}воздуха.`,
    hottestLead: (size) =>
      `Пять самых горячих участков ${size}${NBSP}м внутри черты города, не${NBSP}ближе 1,5${NBSP}км друг к${NBSP}другу. Причина: фактор, который по${NBSP}модели ` +
      'греет участок сильнее всего.',
    vsMean: `к${NBSP}среднему`,
    crowdedLead: (metres) =>
      `Участки из самых горячих 10 % города, где живёт больше всего людей, не${NBSP}ближе 1${NBSP}км друг к${NBSP}другу. Рядом: школы, детские сады и${NBSP}поликлиники ` +
      `до${NBSP}${metres}${NBSP}м по${NBSP}OpenStreetMap.`,
    causesLead: (count, figure, threshold, mean) =>
      `${figure} ${pluralRu(count, ['участок', 'участка', 'участков'])} горячее ${threshold}, в${NBSP}среднем ${mean}. ` +
      `Полоса: сколько градусов фактор добавляет там в${NBSP}среднем по${NBSP}модели; под ней: значение фактора и${NBSP}в${NBSP}какой доле ` +
      'участков он главный.',
    leads: (share) => ` · главный в ${share}`,
    physicsNote: (caveat) =>
      `Полоса: куда уходит солнечная энергия, оставшаяся после теплового излучения поверхности, в${NBSP}среднем по${NBSP}участкам. ${caveat}`,
    measuresLead: (city) =>
      `Меры для самых горячих 10 % ${genitive(city)}, по${NBSP}тому, что их греет. Сколько снимет мера, известно из${NBSP}обзоров по${NBSP}другим ` +
      `городам, ссылка у${NBSP}каждой.`,
    byModel: `; по${NBSP}модели это `,
    mapAlt: (city, a, b) => `Изотермы поверхности: ${city}, линия разреза от ${a} до ${b}`,
    mapFailed: 'Карта не нарисовалась, разрез ниже.',
    mapDrawing: 'Рисую карту…',
    mapCaption: (step, a, b, length) => `Изотермы поверхности через ${step}°, цвет: класс температуры. Линия ${a}–${b}: разрез длиной ${length}.`,
    sectionNote: `Полоса под кривой: что сильнее всего меняет температуру на${NBSP}каждом отрезке.`,
    table: { city: 'Город', island: 'Остров тепла', mean: 'Среднее', hot: 'Горячая 1/10', from: (t) => `от ${t}` },
    tableNote:
      `Остров тепла: поверхность в${NBSP}черте города против кольца вокруг. R²: какую долю разницы температур модель объясняет на${NBSP}кусках города, которых ` +
      `не${NBSP}видела.`,
    weather: 'Погода летом',
    method: (city, count, size, scenes, model, factors) =>
      `Территория ${genitive(city)} разбита на${NBSP}${count} участков ${size}${NBSP}×${NBSP}${size}${NBSP}м. Температура ` +
      `поверхности: медиана ${scenes} ${pluralRu(scenes, ['снимка', 'снимков', 'снимков'])} Landsat 8/9 без облаков. Модель ` +
      `${model} предсказывает её по${NBSP}${factors} факторам, вклад каждого в${NBSP}градусах считает SHAP.`,
    limits: [
      `Это температура поверхности, а${NBSP}не${NBSP}воздуха. Днём она выше и${NBSP}меняется резче.`,
      `Landsat снимает около 11 утра. Вечерний и${NBSP}ночной перегрев здесь не${NBSP}виден.`,
      `Вклад фактора показывает связь в${NBSP}данных, а${NBSP}не${NBSP}эксперимент. Где мало зелени, там обычно плотнее застройка.`,
      `Эффект мер взят из${NBSP}обзоров по${NBSP}другим городам: это ориентир, а${NBSP}не${NBSP}прогноз для участка.`,
    ],
    popLimit: (caveat) => `${caveat} Она показывает, где люди живут, а${NBSP}не${NBSP}где они днём.`,
    basemap: ' Подложка: © OpenStreetMap, OpenFreeMap.',
  },
);
