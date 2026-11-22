import { texts } from '../../i18n/locale';
import { pluralEn, pluralRu } from '../../i18n/plural';
import { genitive } from '../../i18n/russian';

const NBSP = ' ';

export const LANDING_TEXTS = texts(
  {
    hero: {
      title: (city: string) => `Where ${city} overheats in summer, and${NBSP}why`,
      cooler: (city: string) => `Within ${city}, the surface is cooler than around the city: bare ground outside the city line heats up more.`,
      hotter: (city: string, period: string) => `Within ${city}, the surface is hotter than in the ring around it: medians of 200 m cells, ${period}.`,
      surfaceNote: `This is surface temperature from Landsat 8/9 imagery (NASA/USGS) at about 11${NBSP}a.m., not${NBSP}air temperature.`,
      peopleRest: (city: string, threshold: string) => ` live within${NBSP}${city} on${NBSP}the hottest cells, above ${threshold}.`,
      peopleNote: (year: number | undefined) => `WorldPop ${year} estimate: a${NBSP}model, not${NBSP}a${NBSP}census.`,
    },
    map: {
      region: (city: string) => `Surface temperature map: ${city}`,
      foundBefore: 'hot cells found ',
      foundOf: (total: string) => ` of${NBSP}${total}`,
      prompt: (threshold: string) => `Try it: click the map and find a cell at ${threshold} or hotter (the hottest 10%)`,
      gaugeLabel: 'surface temperature, share of the city',
      gaugeHint: `Colour means degrees only; lines every 2°, like contour lines on${NBSP}a mountain map. Hover or tap: the map gives the degrees and${NBSP}the cause.`,
      openFull: 'Open the full map',
    },
    problemTitle: 'Why it matters',
    why: {
      caption: (label: string) => `of what the model explains comes from${NBSP}${label.toLowerCase()}`,
      body: (factors: number, label: string, dominant: boolean) =>
        `The model predicts the temperature of every 200${NBSP}m cell from${NBSP}${factors} factors. ${label} ` +
        `${dominant ? 'outweighs all the others together' : 'weighs more than any other'}. Greenery is measured by${NBSP}the satellite index NDVI: about 0 ` +
        `for${NBSP}asphalt and${NBSP}bare ground, close to${NBSP}1 for${NBSP}dense foliage.`,
      sectionTitle: 'Section through the hottest place where people live',
      sectionHint: 'The band below: what heats each stretch most.',
      energyTitle: 'Where the sunlight goes',
    },
    town: {
      islandCaption: `surface inside the${NBSP}city line against the ring around it`,
      failed: 'The data did not load.',
      computing: 'Computing isotherms.',
      openMap: (city: string) => `Open the map: ${city}`,
      isotherms: (city: string) => `Surface isotherms: ${city}`,
      noData: 'No data',
      computingShort: 'Computing isotherms',
      meanSurface: 'surface, mean',
      hotTenth: 'hottest 10% of the city',
      from: (t: string) => `from ${t}`,
      livingHot: 'live on the hottest cells inside the city line',
      scenes: (n: number, explained: string) => `${n} Landsat ${pluralEn(n, ['scene', 'scenes'])} · the model explains ${explained}`,
      explains: (explained: string) => `the model explains ${explained}`,
      cityMap: (city: string) => `Map of ${city} ↗`,
    },
    towns: {
      title: 'Three cities',
      intro: `One method, the${NBSP}same satellites. The small maps respond to${NBSP}hover and${NBSP}touch; a${NBSP}click opens the full map.`,
      weather: 'Summer weather',
    },
    actions: {
      title: 'What to do',
      intro: (city: string) =>
        `For the hottest 10% of ${city}. The number on the left: how many degrees of surface temperature the model ties to${NBSP}this factor there. ` +
        `It is an association in${NBSP}the data, not${NBSP}the result of an experiment. How much a measure removes is known from${NBSP}reviews of${NBSP}other cities; each has a${NBSP}link.`,
      effectNote: 'tied by the model',
    },
    closing: {
      title: 'How it was computed',
      data: (size: number, period: string, factors: number) =>
        `The city is cut into ${size} by${NBSP}${size}${NBSP}m cells. For each we take the surface temperature from${NBSP}the NASA/USGS Landsat 8 ` +
        `and${NBSP}9 satellites: the median of cloud-free scenes for${NBSP}${period}. Alongside are ${factors} factors: greenery and${NBSP}albedo from${NBSP}Sentinel-2, built-up area ` +
        `and${NBSP}ground from${NBSP}ESA WorldCover, roads and${NBSP}water from${NBSP}OpenStreetMap, building height and${NBSP}volume from${NBSP}OpenStreetMap and${NBSP}GHSL, terrain from${NBSP}Copernicus DEM.`,
      model: (type: string) =>
        `An ${type} model (gradient boosting, a common machine-learning method) predicts the temperature from${NBSP}the factors; we test it on${NBSP}parts of the city it has not${NBSP}seen. SHAP, a standard way to split a prediction among its inputs, gives each factor's contribution ` +
        `in${NBSP}degrees: an${NBSP}association in${NBSP}the data, not${NBSP}an${NBSP}experiment. The heat island is the median of cells inside the city line minus the median of the ring around it.`,
      people: (year: number) =>
        `Residents per cell come from${NBSP}WorldPop ${year}: a model that spreads the census over the buildings seen on${NBSP}imagery, not${NBSP}a${NBSP}count ` +
        `of people. Schools, kindergartens and${NBSP}clinics come from${NBSP}OpenStreetMap.`,
      figures: (lst: number, s2: number, cells: string, explained: string, error: string) =>
        `${lst} Landsat ${pluralEn(lst, ['scene', 'scenes'])} · ${s2} Sentinel-2 ${pluralEn(s2, ['scene', 'scenes'])} · ${cells} cells · the model explains ${explained} of the differences, typical error ±${error}`,
      method: `Full method and${NBSP}factors`,
      team: 'Team',
      names: ['Amira', 'Oliya', 'Maxim', 'Shakhina', 'Stepan'],
      github: `Code on${NBSP}GitHub ↗`,
      openMap: 'Open the map',
      credit:
        `Imagery NASA/USGS Landsat and${NBSP}ESA Sentinel-2, land cover ESA WorldCover, buildings GHSL (JRC), population WorldPop, weather ERA5 (Copernicus) ` +
        'via Open-Meteo, basemap © OpenStreetMap, OpenFreeMap. © 2026 UzHa',
    },
  },
  {
    hero: {
      title: (city) => `Где ${city} перегревается летом и${NBSP}почему`,
      cooler: (city) => `Поверхность в черте ${genitive(city)} прохладнее, чем вокруг: голая земля за чертой нагревается сильнее.`,
      hotter: (city, period) => `Поверхность в черте ${genitive(city)} горячее, чем в кольце вокруг: медианы участков 200 м, ${period}.`,
      surfaceNote: `Это температура поверхности по${NBSP}снимкам Landsat 8/9 (NASA/USGS) около 11 утра, не${NBSP}воздуха.`,
      peopleRest: (city, threshold) => ` живут в${NBSP}черте ${genitive(city)} на${NBSP}самых горячих участках, горячее ${threshold}.`,
      peopleNote: (year) => `По${NBSP}оценке WorldPop ${year}: это модель, а${NBSP}не${NBSP}перепись.`,
    },
    map: {
      region: (city) => `Карта температуры поверхности: ${city}`,
      foundBefore: 'найдено горячих участков ',
      foundOf: (total) => ` из${NBSP}${total}`,
      prompt: (threshold) => `Попробуйте: нажмите на карту и найдите участок от ${threshold} и горячее (самые горячие 10 %)`,
      gaugeLabel: 'температура поверхности, доля города',
      gaugeHint: `Цвет значит только градусы, линии через каждые 2°, как горизонтали на${NBSP}карте гор. Наведите или коснитесь: карта скажет градусы и${NBSP}причину.`,
      openFull: 'Открыть карту целиком',
    },
    problemTitle: 'Почему это важно',
    why: {
      caption: (label) => `того, что объясняет модель, приходится на${NBSP}${label.toLowerCase()}`,
      body: (factors, label, dominant) =>
        `Модель предсказывает температуру каждого участка 200${NBSP}м по${NBSP}${factors} факторам. ${label} ` +
        `${dominant ? 'весит больше, чем все остальные вместе' : 'весит больше любого другого'}. Зелень меряем индексом NDVI со${NBSP}спутника: около 0 ` +
        `у${NBSP}асфальта и${NBSP}голой земли, ближе к${NBSP}1 у${NBSP}густой листвы.`,
      sectionTitle: 'Разрез через самое жаркое место, где живут люди',
      sectionHint: 'Полоса внизу: что греет каждый отрезок сильнее всего.',
      energyTitle: 'Куда уходит солнце',
    },
    town: {
      islandCaption: `поверхность в${NBSP}черте против кольца вокруг`,
      failed: 'Данные не загрузились.',
      computing: 'Считаю изотермы.',
      openMap: (city) => `Открыть карту: ${city}`,
      isotherms: (city) => `Изотермы поверхности: ${city}`,
      noData: 'Нет данных',
      computingShort: 'Считаю изотермы',
      meanSurface: 'поверхность, в среднем',
      hotTenth: 'самые горячие 10 % города',
      from: (t) => `от ${t}`,
      livingHot: 'живут на самых горячих участках в черте',
      scenes: (n, explained) => `${n} ${pluralRu(n, ['снимок', 'снимка', 'снимков'])} Landsat · модель объясняет ${explained}`,
      explains: (explained) => `модель объясняет ${explained}`,
      cityMap: (city) => `Карта ${genitive(city)} ↗`,
    },
    towns: {
      title: 'Три города',
      intro: `Одна методика, одни и${NBSP}те${NBSP}же спутники. Мини-карты отвечают на${NBSP}наведение и${NBSP}касание, по${NBSP}клику открываются целиком.`,
      weather: 'Погода летом',
    },
    actions: {
      title: 'Что делать',
      intro: (city) =>
        `Для самых горячих 10${NBSP}% ${genitive(city)}. Число слева: на${NBSP}сколько градусов поверхности этот фактор по${NBSP}модели связан с${NBSP}жарой ` +
        `там. Это связь в${NBSP}данных, а${NBSP}не${NBSP}результат эксперимента. Сколько снимет мера, известно из${NBSP}обзоров по${NBSP}другим городам, ссылка у${NBSP}каждой.`,
      effectNote: 'связано по модели',
    },
    closing: {
      title: 'Как посчитали',
      data: (size, period, factors) =>
        `Город режем на${NBSP}участки ${size} на${NBSP}${size}${NBSP}м. Для каждого берём температуру поверхности со${NBSP}спутников NASA/USGS Landsat 8 ` +
        `и${NBSP}9: медиана безоблачных снимков за${NBSP}${period}. Рядом ${factors} факторов: зелень и${NBSP}альбедо по${NBSP}Sentinel-2, застройка ` +
        `и${NBSP}грунт по${NBSP}ESA WorldCover, дороги и${NBSP}вода по${NBSP}OpenStreetMap, высота и${NBSP}объём зданий по${NBSP}OpenStreetMap и${NBSP}GHSL, рельеф по${NBSP}Copernicus DEM.`,
      model: (type) =>
        `Модель ${type} (градиентный бустинг, распространённый метод машинного обучения) предсказывает температуру по${NBSP}факторам, проверяем её на${NBSP}кусках города, которых она не${NBSP}видела. Вклад фактора в${NBSP}градусах ` +
        `считает SHAP, стандартный способ разложить прогноз по${NBSP}факторам: это связь в${NBSP}данных, а${NBSP}не${NBSP}эксперимент. Остров тепла: медиана участков внутри черты города минус медиана кольца вокруг.`,
      people: (year) =>
        `Жителей участка берём из${NBSP}WorldPop ${year}: это модель, которая раскладывает перепись по${NBSP}застройке на${NBSP}снимках, а${NBSP}не${NBSP}подсчёт ` +
        `людей. Школы, детские сады и${NBSP}поликлиники взяты из${NBSP}OpenStreetMap.`,
      figures: (lst, s2, cells, explained, error) =>
        `${lst} ${pluralRu(lst, ['снимок', 'снимка', 'снимков'])} Landsat · ${s2} ${pluralRu(s2, ['снимок', 'снимка', 'снимков'])} Sentinel-2 · ${cells} участков · модель объясняет ${explained} различий, типичная ошибка ±${error}`,
      method: `Весь метод и${NBSP}факторы`,
      team: 'Команда',
      names: ['Амира', 'Олия', 'Максим', 'Шахина', 'Степан'],
      github: `Код на${NBSP}GitHub ↗`,
      openMap: 'Открыть карту',
      credit:
        `Снимки NASA/USGS Landsat и${NBSP}ESA Sentinel-2, покрытие ESA WorldCover, здания GHSL (JRC), население WorldPop, погода ERA5 (Copernicus) ` +
        'через Open-Meteo, подложка © OpenStreetMap, OpenFreeMap. © 2026 UzHa',
    },
  },
);
