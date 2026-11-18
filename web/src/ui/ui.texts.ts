import { texts } from '../i18n/locale';
import { genitive } from '../i18n/russian';

const NBSP = ' ';

export const APP_TEXTS = texts(
  {
    retry: 'Try again',
    close: 'Close',
    footerLead: 'UzHa: heat islands of Tashkent, Samarkand and Bukhara from NASA/USGS Landsat imagery.',
    footerCode: `The code is open on${NBSP}`,
    unknownCity: (id: string, opened: string) => `There is no city “${id}” in the data; ${opened} is open instead.`,
    titleTool: (city: string) => `${city}: heat map, UzHa`,
    titleMethod: (city: string) => `How it is calculated: ${city}, UzHa`,
    titleStory: 'UzHa: where the city overheats in summer',
    noCities: 'cities.json has no cities.',
    cityFailed: (city: string) => `Could not load the data for ${city}. Check the connection and try again.`,
    cityEmpty: (city: string) => `There is no data for ${city} yet.`,
    loadingCities: 'Loading cities',
    citiesFailed: 'Could not load the list of cities. Check the connection and try again.',
  },
  {
    retry: 'Повторить',
    close: 'Закрыть',
    footerLead: `UzHa: острова тепла Ташкента, Самарканда и${NBSP}Бухары по${NBSP}снимкам NASA/USGS Landsat.`,
    footerCode: `Код открыт на${NBSP}`,
    unknownCity: (id, opened) => `Города «${id}» в данных нет, открыт ${opened}.`,
    titleTool: (city) => `${city}: карта жары, UzHa`,
    titleMethod: (city) => `Как посчитано: ${city}, UzHa`,
    titleStory: 'UzHa: где город перегревается летом',
    noCities: 'В cities.json нет ни одного города.',
    cityFailed: (city) => `Не получилось загрузить данные ${genitive(city)}. Проверьте связь и попробуйте ещё раз.`,
    cityEmpty: (city) => `Для ${genitive(city)} данных пока нет.`,
    loadingCities: 'Загружаю города',
    citiesFailed: 'Не получилось загрузить список городов. Проверьте связь и попробуйте ещё раз.',
  },
);

export const BAR_TEXTS = texts(
  {
    sections: { problem: 'Problem', why: 'Why it is hot', cities: 'Cities', method: 'Method' },
    sectionsLabel: 'Sections',
    openMap: 'Open the map',
    map: 'Map',
    /** The switch shows the other language, in that language. */
    switchTo: 'RU',
    switchLabel: 'Русская версия',
  },
  {
    sections: { problem: 'Проблема', why: 'Почему жарко', cities: 'Города', method: 'Как считали' },
    sectionsLabel: 'Разделы',
    openMap: 'Открыть карту',
    map: 'Карта',
    switchTo: 'EN',
    switchLabel: 'English version',
  },
);

export const TOOL_TEXTS = texts(
  {
    unnamed: 'Unnamed place on the map',
    flat: 'Back to the flat map',
    threeD: 'Show the city in 3D',
    flatShort: 'Flat map',
    threeDShort: 'City in 3D',
    copied: 'Link copied',
    share: 'Share',
    report: 'Report',
    wholeCity: 'Whole city',
    exportAll: (city: string) => `All cells of ${city}: temperature, factors, contributions`,
    howCalculated: 'How it is calculated',
    mapToolbar: 'Map',
    drawing: 'Draw',
    section: 'Section',
    causes: 'Causes',
    people: 'People',
    panel: 'What is going on here',
  },
  {
    unnamed: 'Участок без названия на карте',
    flat: 'Вернуть плоскую карту',
    threeD: 'Показать город в 3D',
    flatShort: 'Плоская карта',
    threeDShort: 'Город в 3D',
    copied: 'Ссылка скопирована',
    share: 'Поделиться',
    report: 'Отчёт',
    wholeCity: 'Весь город',
    exportAll: (city) => `Все участки ${genitive(city)}: температура, факторы, вклады`,
    howCalculated: 'Как это посчитано',
    mapToolbar: 'Карта',
    drawing: 'Ведите',
    section: 'Разрез',
    causes: 'Причины',
    people: 'Люди',
    panel: 'Что здесь происходит',
  },
);

export const PANEL_TEXTS = texts(
  {
    inHottestTenth: (measure: string) => `in the hottest tenth: ${measure}`,
    cityMean: (value: string) => `, city average ${value}`,
    figureHere: (mean: string) => `here; city average ${mean}`,
    figureCity: (min: string, max: string) => `city average, from ${min} to ${max}`,
    energyPlace: 'Physics of the place',
    energyHot: 'Physics of the hottest tenth',
    ramp: (value: string) => `City temperature scale, ${value} marked`,
  },
  {
    inHottestTenth: (measure) => `в горячей десятой части ${measure}`,
    cityMean: (value) => `, в среднем по городу ${value}`,
    figureHere: (mean) => `здесь, в среднем по городу ${mean}`,
    figureCity: (min, max) => `в среднем по городу, от ${min} до ${max}`,
    energyPlace: 'Физика участка',
    energyHot: 'Физика горячей десятой части',
    ramp: (value) => `Шкала температуры города, отмечено ${value}`,
  },
);

export const ENERGY_UI_TEXTS = texts(
  {
    intake: { before: 'Sunlight absorbed: ', middle: "; after the surface's own thermal radiation, ", after: ' is left. Where it goes:' },
    rows: { hot: 'Hottest tenth', mean: 'Whole city', green: 'Greenest tenth' },
    split: (air: string, evaporation: string) => `to the air ${air} · to evaporation ${evaporation}`,
  },
  {
    intake: { before: 'Поглощено солнца ', middle: ', после теплового излучения остаётся ', after: '. Куда оно уходит:' },
    rows: { hot: 'Горячая десятая часть', mean: 'Весь город', green: 'Зелёная десятая часть' },
    split: (air, evaporation) => `в воздух ${air} · на испарение ${evaporation}`,
  },
);

export const WEATHER_UI_TEXTS = texts(
  {
    title: 'Summer weather',
    airNotSurface: 'This is air, not surface.',
    summer: 'Summer',
  },
  {
    title: 'Погода летом',
    airNotSurface: `Это воздух, а${NBSP}не${NBSP}поверхность.`,
    summer: 'Лето',
  },
);

export const SECTION_TEXTS = texts(
  {
    causeKey: 'What heats most, by hatching',
    peopleKey: 'What the People layer shows',
    residents: 'residents of the cell',
    facilities: (count: string) => `schools, kindergartens and clinics on the hottest cells within the city line: ${count}`,
    peopleNote: (threshold: string, people: string) => `On the hottest cells, above ${threshold}, ${people} live within the city line.`,
    section: 'Section',
    drawing: 'Draw on the map',
    newSection: 'New section',
    alreadyHottestTitle: 'The section already runs through the hottest place in the city',
    hottestTitle: 'Put the section back through the hottest place',
    alreadyHottest: 'Already through the hottest',
    hottest: 'Through the hottest',
    causesOnMap: 'Causes on the map',
    people: 'People',
  },
  {
    causeKey: 'Что греет сильнее всего, по штриховке',
    peopleKey: 'Что на карте в слое «Люди»',
    residents: 'жители участка',
    facilities: (count) => `школы, сады и поликлиники на самых горячих участках в черте города: ${count}`,
    peopleNote: (threshold, people) => `На самых горячих участках, горячее ${threshold}, в черте города живут ${people}.`,
    section: 'Разрез',
    drawing: 'Ведите по карте',
    newSection: 'Новый разрез',
    alreadyHottestTitle: 'Разрез уже идёт через самое жаркое место города',
    hottestTitle: 'Вернуть разрез через самое жаркое место',
    alreadyHottest: 'Уже через самое жаркое',
    hottest: 'Через самое жаркое',
    causesOnMap: 'Причины на карте',
    people: 'Люди',
  },
);

export const PROFILE_TEXTS = texts(
  {
    km: 'km',
    label: 'Temperature and causes along the section',
    mean: (value: string) => `mean ${value}`,
  },
  {
    km: 'км',
    label: 'Температура и причины вдоль разреза',
    mean: (value) => `среднее ${value}`,
  },
);

/** What each slider is called, how its value is said aloud (screen readers get the unit in words) and its noun for a cut. */
export interface LeverWords {
  label: string;
  spoken: (value: string) => string;
  noun?: string;
}

export const WHAT_IF_TEXTS = texts(
  {
    levers: {
      tree: { label: 'Trees', spoken: (v: string) => `trees on ${v} of the area` },
      ndvi: { label: 'Greenery, NDVI', spoken: (v: string) => `NDVI ${v}` },
      albedo: { label: 'Light roofs and paving, albedo', spoken: (v: string) => `albedo ${v}` },
      built: { label: 'Built-up', spoken: (v: string) => `${v} of the area built up`, noun: 'of built-up' },
      roads: { label: 'Roads', spoken: (v: string) => `${v} of road`, noun: 'of roads' },
    } as Record<'tree' | 'ndvi' | 'albedo' | 'built' | 'roads', LeverWords>,
    spokenOther: (label: string, value: string) => `${label} ${value}`,
    cityTail: (up: boolean) => `${up ? 'top' : 'bottom'} 5% of the city`,
    limit: (to: string, reason: string) => `up to ${to}: ${reason}`,
    now: (value: string) => `now ${value}`,
    spokenNow: (value: string, now: string) => `${value}, now ${now}`,
    loading: 'Loading the city model…',
    failed: 'The model did not load. Close the block and open it again.',
    nothingToAdd: 'Nothing to add here: trees, greenery and light surfaces are already as high as anywhere in the city.',
    noChange: 'no change yet',
    toSurface: ' to the surface temperature here',
    result: (after: string, before: string) => `surface here: about ${after} instead of ${before}`,
    hint: 'move a slider and the model recalculates the surface temperature',
    reset: 'Reset',
    caveat: 'From the model: an association in the data, not an experiment; surface, not air.',
    treesNote: ' “Trees” here is only the crown share; grass and leaves under them count in NDVI, so greenery changes more.',
    title: 'What if',
    recalc: 'recalculate with the model',
  },
  {
    levers: {
      tree: { label: 'Деревья', spoken: (v) => `деревья на ${v} площади` },
      ndvi: { label: 'Зелень, NDVI', spoken: (v) => `NDVI ${v}` },
      albedo: { label: 'Светлые крыши и покрытия, альбедо', spoken: (v) => `альбедо ${v}` },
      built: { label: 'Застройка', spoken: (v) => `застроено ${v} площади`, noun: 'застройки' },
      roads: { label: 'Дороги', spoken: (v) => `${v} дорог`, noun: 'дорог' },
    },
    spokenOther: (label, value) => `${label} ${value}`,
    cityTail: (up) => `${up ? 'верхние' : 'нижние'} 5 % города`,
    limit: (to, reason) => `до ${to} — ${reason}`,
    now: (value) => `сейчас ${value}`,
    spokenNow: (value, now) => `${value}, сейчас ${now}`,
    loading: 'Загружаю модель города…',
    failed: 'Модель не загрузилась. Закройте и откройте блок ещё раз.',
    nothingToAdd: 'Здесь нечего прибавить: деревьев, зелени и светлых покрытий уже столько, сколько бывает в городе.',
    noChange: 'пока без изменений',
    toSurface: ' к температуре поверхности здесь',
    result: (after, before) => `к поверхности здесь: около ${after} вместо ${before}`,
    hint: 'подвиньте ползунок, модель пересчитает температуру поверхности',
    reset: 'Вернуть как есть',
    caveat: 'По модели: связь в данных, не эксперимент; поверхность, не воздух.',
    treesNote: ' «Деревья» здесь только доля крон; трава и листва под ними идут в NDVI, поэтому зелень меняет больше.',
    title: 'Что если',
    recalc: 'пересчитать по модели',
  },
);

export const PLAN_TEXTS = texts(
  {
    failed: 'The model did not load. Close the block and open it again.',
    computing: 'Calculating over every cell of the city…',
    none: 'There are no cells in the city where trees would noticeably cool housing.',
    forPeople: (people: string) => `for ${people}`,
    caveat:
      'Planting on each cell: +20 pp tree crowns and +0.1 NDVI, no further than the greenest 5% of the city. Order: degrees of cooling × residents. ' +
      'From the model: surface, not air.',
    title: 'Where to plant first',
    compute: 'calculate for the city',
  },
  {
    failed: 'Модель не загрузилась. Закройте и откройте блок ещё раз.',
    computing: 'Считаю по всем участкам города…',
    none: 'В городе нет участков, где деревья заметно охладили бы жильё.',
    forPeople: (people) => `для ${people}`,
    caveat:
      'Посадка на каждом участке: +20 п.п. крон и +0,1 NDVI, не дальше самых зелёных 5 % города. Порядок: градусы охлаждения × число жителей. ' +
      'По модели: поверхность, не воздух.',
    title: 'Где сажать первым',
    compute: 'посчитать по городу',
  },
);

export const MISC_TEXTS = texts(
  {
    hint: (touch: boolean) => `Tap a cell to see its cause · drag A and B to draw a section${touch ? '' : ' · or drag across the map with Shift held'}`,
    hideHint: 'Hide the hint',
    city: 'City',
    photo: (credit: string) => `Photo: ${credit}`,
  },
  {
    hint: (touch) =>
      `Нажмите на${NBSP}участок, чтобы узнать причину · тяните А и${NBSP}Б, чтобы сделать разрез${touch ? '' : ' · или ведите по карте с зажатым Shift'}`,
    hideHint: 'Скрыть подсказку',
    city: 'Город',
    photo: (credit) => `Фото: ${credit}`,
  },
);
