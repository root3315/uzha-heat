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
    unnamed: 'Unnamed cell on the map',
    flat: 'Back to the flat map',
    threeD: 'Show the city in 3D',
    flatShort: 'Flat map',
    threeDShort: 'City in 3D',
    copied: 'Copied',
    share: 'Share',
    report: 'Report',
    wholeCity: 'Whole city',
    exportAll: (city: string) => `All cells of ${city}: temperature, factors, contributions`,
    howCalculated: 'How it is calculated',
    mapToolbar: 'Map',
    marksKey: { section: 'section', plan: 'where to plant first' },
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
    copied: 'Скопировано',
    share: 'Поделиться',
    report: 'Отчёт',
    wholeCity: 'Весь город',
    exportAll: (city) => `Все участки ${genitive(city)}: температура, факторы, вклады`,
    howCalculated: 'Как это посчитано',
    mapToolbar: 'Карта',
    marksKey: { section: 'разрез', plan: 'где сажать первым делом' },
    drawing: 'Ведите по карте',
    section: 'Разрез',
    causes: 'Причины',
    people: 'Люди',
    panel: 'Что здесь происходит',
  },
);

export const PANEL_TEXTS = texts(
  {
    inHottestTenth: (measure: string) => `in the hottest 10% of the city: ${measure}`,
    cityMean: (value: string) => `, city average ${value}`,
    figureHere: (mean: string) => `surface temperature here; city average ${mean}. Air is cooler.`,
    figureCity: (min: string, max: string) => `surface temperature, city average, from ${min} to ${max}. Air is cooler.`,
    energyPlace: 'Physics of the cell',
    energyHot: 'Physics of the hottest 10% of the city',
    ramp: (value: string) => `City temperature scale, ${value} marked`,
  },
  {
    inHottestTenth: (measure) => `в самых горячих 10 % города ${measure}`,
    cityMean: (value) => `, в среднем по городу ${value}`,
    figureHere: (mean) => `температура поверхности здесь, в среднем по городу ${mean}. Воздух прохладнее.`,
    figureCity: (min, max) => `температура поверхности, в среднем по городу, от ${min} до ${max}. Воздух прохладнее.`,
    energyPlace: 'Физика участка',
    energyHot: 'Физика самых горячих 10 % города',
    ramp: (value) => `Шкала температуры города, отмечено ${value}`,
  },
);

export const ENERGY_UI_TEXTS = texts(
  {
    intake: { before: 'Sunlight absorbed: ', middle: "; after the surface's own thermal radiation, ", after: ' is left. Where it goes:' },
    rows: { hot: 'Hottest 10% of the city', mean: 'Whole city', green: 'Greenest 10% of the city' },
    split: (air: string, evaporation: string) => `to the air ${air} · to evaporation ${evaporation}`,
  },
  {
    intake: { before: 'Поглощено солнца ', middle: ', после теплового излучения остаётся ', after: '. Куда оно уходит:' },
    rows: { hot: 'Самые горячие 10 % города', mean: 'Весь город', green: 'Самые зелёные 10 % города' },
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
    alreadyHottestTitle: 'The section already runs through the hottest place in the city where people live',
    hottestTitle: 'Put the section back through the hottest place where people live',
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
    alreadyHottestTitle: 'Разрез уже идёт через самое жаркое место города, где живут люди',
    hottestTitle: 'Вернуть разрез через самое жаркое место, где живут люди',
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
      ndvi: { label: 'Greenery, NDVI', spoken: (v: string) => `greenery index NDVI ${v}` },
      built: { label: 'Built-up', spoken: (v: string) => `${v} of the area built up`, noun: 'of built-up' },
      roads: { label: 'Roads', spoken: (v: string) => `${v} of road`, noun: 'of roads' },
    } as Record<'tree' | 'ndvi' | 'built' | 'roads', LeverWords>,
    spokenOther: (label: string, value: string) => `${label} ${value}`,
    cityTail: (lever: string, up: boolean) => {
      if (lever === 'tree' || lever === 'ndvi') return "as in the city's greenest 5%";
      if (lever === 'built') return "as in the city's least built-up 5%";
      if (lever === 'roads') return 'as in the 5% of the city with the fewest roads';
      return `as in the city's ${up ? 'top' : 'bottom'} 5%`;
    },
    limit: (to: string, reason: string) => `up to ${to}, ${reason}`,
    now: (value: string) => `now ${value}`,
    spokenNow: (value: string, now: string) => `${value}, now ${now}`,
    loading: 'Loading the city model…',
    failed: 'The model did not load. Close the block and open it again.',
    nothingToAdd: 'Nothing to add here: trees and greenery are already as high as anywhere in the city.',
    noChange: 'no change yet',
    toSurface: ' to the surface temperature here',
    result: (after: string, before: string) => `surface here: about ${after} instead of ${before}`,
    hint: 'move a slider and the model recalculates the surface temperature',
    reset: 'Reset',
    caveat: 'From the model: an association in the data, not an experiment; surface, not air.',
    treesNote: ' “Trees” here is only the crown share; grass and leaves under them count in NDVI, so greenery changes more. New crowns take the place of bare ground first, then of built-up.',
    title: 'What if',
    recalc: 'statistical model estimate',
  },
  {
    levers: {
      tree: { label: 'Деревья', spoken: (v) => `деревья на ${v} площади` },
      ndvi: { label: 'Зелень, NDVI', spoken: (v) => `индекс зелени NDVI ${v}` },
      built: { label: 'Застройка', spoken: (v) => `застроено ${v} площади`, noun: 'застройки' },
      roads: { label: 'Дороги', spoken: (v) => `${v} дорог`, noun: 'дорог' },
    },
    spokenOther: (label, value) => `${label} ${value}`,
    cityTail: (lever, up) => {
      if (lever === 'tree' || lever === 'ndvi') return 'как в самых зелёных 5 % города';
      if (lever === 'built') return 'как в самых малозастроенных 5 % города';
      if (lever === 'roads') return 'как в 5 % города, где меньше всего дорог';
      return `как в ${up ? 'верхних' : 'нижних'} 5 % города`;
    },
    limit: (to, reason) => `до ${to}, ${reason}`,
    now: (value) => `сейчас ${value}`,
    spokenNow: (value, now) => `${value}, сейчас ${now}`,
    loading: 'Загружаю модель города…',
    failed: 'Модель не загрузилась. Закройте и откройте блок ещё раз.',
    nothingToAdd: 'Здесь нечего прибавить: деревьев и зелени уже столько, сколько бывает в городе.',
    noChange: 'пока без изменений',
    toSurface: ' к температуре поверхности здесь',
    result: (after, before) => `поверхность здесь: около ${after} вместо ${before}`,
    hint: 'подвиньте ползунок, модель пересчитает температуру поверхности',
    reset: 'Вернуть как есть',
    caveat: 'По модели: связь в данных, не эксперимент; поверхность, не воздух.',
    treesNote: ' «Деревья» здесь только доля крон; трава и листва под ними идут в NDVI, поэтому зелень меняет больше. Новые кроны занимают место сначала голого грунта, потом застройки.',
    title: 'Что если',
    recalc: 'оценка статистической модели',
  },
);

/** "Surfaces (physics)": the energy-balance model of the picked place, with what its roofs and roads are made of. */
export const SURFACES_TEXTS = texts(
  {
    title: 'Surfaces (physics)',
    recalc: 'physics estimate',
    levers: {
      roofAlbedo: { label: 'Roof albedo', spoken: (v: string) => `roof albedo ${v}` },
      roadAlbedo: { label: 'Road albedo', spoken: (v: string) => `road albedo ${v}` },
      greenRoofs: { label: 'Green roofs', spoken: (v: string) => `${v} of the roof area green` },
    } as Record<'roofAlbedo' | 'roadAlbedo' | 'greenRoofs', LeverWords>,
    limits: {
      roofAlbedo: (to: string) => `up to ${to}, as with a new white coating`,
      roadAlbedo: (to: string) => `up to ${to}, as with light concrete`,
      greenRoofs: (to: string) => `up to ${to}, every roof`,
    } as Record<'roofAlbedo' | 'roadAlbedo' | 'greenRoofs', (to: string) => string>,
    loading: 'Loading the physics of the city…',
    failed: 'The physics did not load. Close the block and open it again.',
    nothing: 'No roofs or roads here to change.',
    unsettled: 'The energy balance does not close for this cell, so the model gives no number here.',
    treated: (delta: string, share: string) => `on the changed surfaces themselves ${delta}; they cover ${share} of the cell`,
    skill: (share: string) => `Physics model: it explains ${share} of the pattern of surface heat in this city. `,
    assumptions:
      'Assumed: the weather of the Landsat days; only the albedo (the share of sunlight reflected) changes, not the heat stored in roofs and roads; green roofs are watered and behave like the grass here. Surface, not air.',
  },
  {
    title: 'Поверхности (физика)',
    recalc: 'оценка по физике',
    levers: {
      roofAlbedo: { label: 'Альбедо крыш', spoken: (v) => `альбедо крыш ${v}` },
      roadAlbedo: { label: 'Альбедо дорог', spoken: (v) => `альбедо дорог ${v}` },
      greenRoofs: { label: 'Зелёные крыши', spoken: (v) => `зелёные ${v} площади крыш` },
    },
    limits: {
      roofAlbedo: (to) => `до ${to}, как у нового белого покрытия`,
      roadAlbedo: (to) => `до ${to}, как у светлого бетона`,
      greenRoofs: (to) => `до ${to}, все крыши`,
    },
    loading: 'Загружаю физику города…',
    failed: 'Физика не загрузилась. Закройте и откройте блок ещё раз.',
    nothing: 'Здесь нет крыш и дорог, которые можно поменять.',
    unsettled: 'Баланс энергии здесь не сходится, поэтому модель не даёт числа.',
    treated: (delta, share) => `на самих изменённых поверхностях ${delta}; это ${share} площади участка`,
    skill: (share) => `Физическая модель: объясняет ${share} картины нагрева поверхности в этом городе. `,
    assumptions:
      'Допущения: погода дней съёмки Landsat; меняется только альбедо (доля отражённого солнца), а не тепло, запасённое крышами и дорогами; зелёные крыши поливаются и ведут себя как здешняя трава. Поверхность, не воздух.',
  },
);

export const PLAN_TEXTS = texts(
  {
    failed: 'The model did not load. Close the block and open it again.',
    computing: 'Calculating over every cell of the city…',
    none: 'There are no cells in the city where trees would noticeably cool housing.',
    forPeople: (people: string) => `for ${people}`,
    onMap: (count: number) => (count > 1 ? `Numbers 1–${count} on the map mark these cells.` : 'Number 1 on the map marks this cell.'),
    caveat:
      'Planting on each cell: tree crown cover +20 percentage points (in place of bare ground, then built-up) and greenery index NDVI +0.1, no further than the greenest 5% of the city. Order: degrees of cooling × residents. ' +
      'From the model: surface, not air.',
    title: 'Where to plant first',
    compute: 'whole city, by the model',
    mark: (rank: number, cooling: string, people: string) => `Planting cell ${rank}: ${cooling} ${people}`,
    range: (near: string, far: string) => `model uncertainty: ${near} to ${far}`,
    rangeNote: (replicates: number) =>
      `The range under each cell: where 90% of ${replicates} retrained models land, each trained on a different random draw of 2 km blocks of the city. The first cell's figure is often near the upper end, since it was picked for being large.`,
  },
  {
    failed: 'Модель не загрузилась. Закройте и откройте блок ещё раз.',
    computing: 'Считаю по всем участкам города…',
    none: 'В городе нет участков, где деревья заметно охладили бы жильё.',
    forPeople: (people) => `для ${people}`,
    onMap: (count) => (count > 1 ? `Цифры 1–${count} на карте отмечают эти участки.` : 'Цифра 1 на карте отмечает этот участок.'),
    caveat:
      'Посадка на каждом участке: доля крон +20 процентных пунктов (на месте голого грунта, потом застройки) и индекс зелени NDVI +0,1, не дальше самых зелёных 5 % города. Порядок: градусы охлаждения × число жителей. ' +
      'По модели: поверхность, не воздух.',
    title: 'Где сажать первым',
    compute: 'весь город, по модели',
    mark: (rank, cooling, people) => `Участок для посадки ${rank}: ${cooling} ${people}`,
    range: (near, far) => `разброс модели: от ${near} до ${far}`,
    rangeNote: (replicates) =>
      `Диапазон под каждым участком: куда попадают 90 % из ${replicates} моделей, обученных заново, каждая на своей случайной выборке блоков города по 2 км. Цифра первого участка часто у верхнего края: его и выбрали за то, что она большая.`,
  },
);

export const MISC_TEXTS = texts(
  {
    hint: (touch: boolean) =>
      `${touch ? 'Tap' : 'Click'} a cell to see its cause · drag A and B to draw a section${touch ? '' : ' · or drag across the map with Shift held'}`,
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
