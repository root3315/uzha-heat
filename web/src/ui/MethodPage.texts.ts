import { texts } from '../i18n/locale';
import { pluralEn, pluralRu } from '../i18n/plural';

const NBSP = ' ';

/** One step of the energy balance: its name, formula and the paper it comes from (the link stays in the page). */
interface StepWords {
  name: string;
  formula: string;
  cite: string;
}

export const METHOD_TEXTS = texts(
  {
    title: 'How this was calculated',
    back: 'Back to the map',
    sources: {
      ndvi: 'Sentinel-2 L2A, summer median',
      albedo: 'Sentinel-2, Liang (2001) formula',
      tree: 'ESA WorldCover 2021',
      built: 'ESA WorldCover 2021',
      bare: 'ESA WorldCover 2021',
      water_dist: 'ESA WorldCover and OpenStreetMap',
      roads: 'OpenStreetMap',
      buildings: 'OpenStreetMap',
      height: 'OpenStreetMap and GHSL Built-H 2018',
      volume: 'GHSL Built-S 2020 and Built-H 2018',
      elevation: 'Copernicus DEM GLO-30',
    } as Record<string, string>,
    cells: (city: string, size: number, count: string, period: string, scenes: number, factors: number) =>
      `${city} is divided into ${size} × ${size} m cells, ${count} of them. Each has its summer surface temperature (${period}, median of ` +
      `${scenes} cloud-free Landsat 8/9 ${pluralEn(scenes, ['scene', 'scenes'])}, NASA/USGS imagery) and the ${factors} ` +
      `${pluralEn(factors, ['factor', 'factors'])} listed below.`,
    model: (type: string, share: string, r2: string, error: string) =>
      `A ${type} model learns to predict a cell's temperature from its factors. The check is spatial: the city is cut into blocks, and the model ` +
      `is scored on blocks it has not seen. On this check the model explains ${share} of the temperature variation between cells ` +
      `(R² ${r2}), with a mean error of ${error}.`,
    shap: (base: string) =>
      `SHAP gives each factor's contribution in degrees: from the city's mean estimate, ${base}, to the temperature of a given ` +
      'place. The contributions add up to how far the place is from the mean.',
    island:
      'The heat island is the median temperature of the cells inside the city line (the boundary is from OpenStreetMap) minus the median of the cells in a ring around it. ' +
      'The median, not the mean, so that an airfield or a reservoir does not shift the number.',
    ndvi:
      'Greenery is measured with NDVI from Sentinel-2 imagery: about 0 for asphalt and bare ground, closer to 1 for dense foliage. Albedo, the share of light reflected, ' +
      'rises with the heat here: bare dry ground is the brightest surface and also the hottest. So we read albedo as a sign of open ground, not as ' +
      'something to change.',
    whatIf: (built: string, roads: string) =>
      'The "What if" block in a cell\'s panel runs the same model in the browser: you can add trees, greenery or light surfaces, and where the model ' +
      `says it cools, reduce built-up cover by at most ${built} and roads by at most ${roads}; the sliders stop at the ` +
      "city's outermost 5% of cells, so the model does not guess at combinations it has never seen. This is association in the data, not an experiment, and it is about the " +
      'surface, not the air; albedo there changes with greenery and ground held fixed, and then lighter means cooler, although across the city ' +
      'light surfaces are more often hot.',
    isotherms: (step: string) =>
      `Isotherms are drawn on the smoothed surface every ${step}°. The hatching on the section and on the map shows the factor that ` +
      'moves the temperature most on that stretch.',
    factors: 'Factors',
    robustness: {
      title: 'How robust this is',
      rings: 'The heat island depends on what it is compared with. We took rings of different widths around the city line: if the sign and the size hold, it is not ' +
        'the choice of ring.',
      spread: (spread: string) => ` The rings differ by ${spread}.`,
      ring: (width: string) => `ring up to ${width}${NBSP}km`,
      ringValue: (island: string, inside: string, outside: string, count: string) =>
        `${island}: median ${inside} inside the line against ${outside} around it, ${count} cells in the ring`,
      tooFew: 'too few cells to compare',
      groups:
        'Greenery, trees and bare ground are tied to each other, and the model can split the credit between them almost at random. So we add up the contributions ' +
        'of related factors into groups (SHAP allows this: contributions add up) and look at which group carries more of the contribution in the cells ' +
        'inside the city line. These are shares of the mean contribution, not shares of variance.',
      group: (share: string, mean: string) => `${share} of the mean contribution, ±${mean}° per cell on average`,
    },
    modis: {
      title: 'Check against MODIS, and the night',
      intro:
        'There are no ground measurements of surface temperature to compare the whole map with. So we compare with a second NASA satellite, MODIS ' +
        '(cells of about 1 km, the same summers). Our 200 m cells are averaged to its pixels.',
      day: (product: string, time: string) => `${product}, day ${time}`,
      match: (r: string, warmer: boolean, bias: string, rmse: string, n: string) =>
        `pattern match r = ${r}, our surface is ${warmer ? 'warmer' : 'cooler'} by ${bias}, spread ±${rmse}°, ${n} pixels`,
      ring: (value: string, width: string) => `${value} with a ${width}${NBSP}km ring`,
      warmer: 'the city is also warmer than its surroundings',
      cooler: 'the city is cooler than its surroundings',
      differs: 'the difference between the city and its surroundings',
      night: (product: string, time: string, lead: string, values: string, day: string | null) =>
        `At night (${product}, ${time}) ${lead}: ${values}.${day ? ` By day, from the same satellite: ${day}.` : ''}`,
      nightNote: 'Landsat does not image at night, so we know the night heat island only at 1 km resolution.',
    },
    energy: {
      title: 'Physics of the cell',
      intro: (hour: number) =>
        `The model above is statistical: it looks for associations. Next to it is a physical estimate: where the solar energy goes in each cell around ${hour}:00, ` +
        'in watts per square metre. It is computed only from the map data and coefficients from the papers linked below.',
      conditions: (solar: string, air: string, humidity: string, sky: string, hot: string, cold: string) =>
        `For the city we take the mean conditions at the Landsat overpass hours from ERA5: sunlight ${solar}, air ${air}, humidity ${humidity}%. ` +
        `Heat from the sky is then ${sky}. The hottest place in the city, taken as dry: ${hot}; the coolest green place, taken as evaporating all it can: ${cold}.`,
      storage:
        'How much heat a surface stores by evening is not computed per cell: only reference material properties (Oke 1987, table 2.1). Thermal ' +
        'admittance shows how readily a surface takes heat in deep and gives it back.',
      surface: (capacity: string, conductivity: string, admittance: string) =>
        `heat capacity ${capacity} MJ/(m³·K), conductivity ${conductivity} W/(m·K), thermal admittance ${admittance} J/(m²·K·s½)`,
      limitsLead: 'Simplifications:',
      limits: [
        'One model and one moment: the median summer surface temperature against the mean weather at the overpass hours.',
        'ERA5 sunlight, air and humidity are the same for the whole city (one point about 25 km across). Shade from buildings and trees, and wind, are not included.',
        'Emissivity comes from NDVI only: asphalt and roofs get 0.97, real ones 0.90–0.95. Over built-up cells Rn is therefore slightly low.',
        'The SEBAL ground-heat formula was fitted on fields and steppe. In dense built-up areas walls and asphalt take up to 30–40% of Rn by day, more than it gives.',
        "Evaporation is relative to the hottest and coolest places of the city itself, so cells within a city can be compared, cities with each other only with care.",
      ],
      steps: [
        { name: 'Absorbed sunlight', formula: "S = (1 − α) · S↓, α: the cell's albedo from Sentinel-2, S↓: ERA5 solar radiation at the overpass hours", cite: 'Liang 2001' },
        { name: 'Emissivity', formula: 'ε = 0.97 for NDVI < 0.2; 0.99 for NDVI > 0.5; in between a mix of soil and foliage, Pv = ((NDVI − 0.2) / 0.3)²', cite: 'Sobrino et al. 2004' },
        { name: 'Heat from the surface', formula: 'L↑ = ε · σ · T⁴, T: Landsat surface temperature in kelvin, σ = 5.67·10⁻⁸ W/(m²·K⁴)', cite: 'Stefan–Boltzmann constant, CODATA' },
        { name: 'Heat from the sky', formula: 'L↓ = 1.24 · (e / Tₐ)^(1/7) · σ · Tₐ⁴, clear sky; e: vapour pressure from humidity by the Magnus formula, Tₐ: ERA5 air', cite: 'Brutsaert 1975' },
        { name: 'Remainder, net radiation', formula: 'Rn = S + ε · L↓ − L↑', cite: 'Allen et al. 2007' },
        { name: 'Into the ground', formula: 'G = Rn · T(°C) · (0.0038 + 0.0074 · α) · (1 − 0.98 · NDVI⁴)', cite: 'Bastiaanssen 2000, SEBAL' },
        {
          name: 'Evaporation',
          formula:
            'LE = EF · (Rn − G), EF = (T hot − T) / (T hot − T cool), from 0 to 1. Hot place: the hottest 5% of the 10% least green cells; cool place: the coolest 5% of the 10% greenest',
          cite: 'Roerink et al. 2000, S-SEBI',
        },
        { name: 'Hot and cool places', formula: 'reference cells inside the city, picked by NDVI and temperature; SSEB does the same', cite: 'Senay et al. 2007' },
        { name: 'Heating the air', formula: 'H = Rn − G − LE: what does not go into the ground or evaporation heats the air', cite: 'Bastiaanssen et al. 1998, SEBAL' },
      ] as StepWords[],
    },
    limitsTitle: 'What the map does not know',
    limits: [
      'This is the temperature of the surface, not the air. By day it is higher and changes more sharply.',
      'Landsat passes at about 11 in the morning. Evening and night heat do not show on the map; the night heat island above is estimated from MODIS at 1 km.',
      'A factor contribution shows association in the data, not an experiment. Factors are tied to each other: where there is little greenery, buildings are usually denser.',
      'What measures achieve is known from reviews of other cities, linked at each measure. Those are more often about air than surface: a guide, not a forecast for the cell.',
      'Airfields and railway tracks are hot because of their paving; the map does not suggest trees there.',
    ],
    layers: (period: string, population: number | null) =>
      `Layers come from different years: imagery ${period}, ESA WorldCover 2021 land cover, GHSL 2018 building heights` +
      (population ? `, WorldPop ${population} population` : '') +
      '.',
  },
  {
    title: 'Как это посчитано',
    back: 'Вернуться к карте',
    sources: {
      ndvi: 'Sentinel-2 L2A, летняя медиана',
      albedo: 'Sentinel-2, формула Liang (2001)',
      tree: 'ESA WorldCover 2021',
      built: 'ESA WorldCover 2021',
      bare: 'ESA WorldCover 2021',
      water_dist: 'ESA WorldCover и OpenStreetMap',
      roads: 'OpenStreetMap',
      buildings: 'OpenStreetMap',
      height: 'OpenStreetMap и GHSL Built-H 2018',
      volume: 'GHSL Built-S 2020 и Built-H 2018',
      elevation: 'Copernicus DEM GLO-30',
    },
    cells: (city, size, count, period, scenes, factors) =>
      `${city} разбит на участки ${size} × ${size} м, их ${count}. Для каждого есть температура ` +
      `поверхности летом (${period}, медиана ${scenes} ${pluralRu(scenes, ['снимка', 'снимков', 'снимков'])} Landsat 8/9 без ` +
      `облаков, снимки NASA/USGS) и ${factors} ${pluralRu(factors, ['фактор', 'фактора', 'факторов'])}, перечисленных ниже.`,
    model: (type, share, r2, error) =>
      `Модель ${type} учится предсказывать температуру участка по его факторам. Проверка пространственная: город режется на блоки, и модель ` +
      `оценивают на тех, которых она не видела. На такой проверке модель объясняет ${share} разброса температуры между участками ` +
      `(R² ${r2}), средняя ошибка ${error}.`,
    shap: (base) =>
      `Вклад каждого фактора в градусах считает метод SHAP: от средней оценки по городу, ${base}, до температуры конкретного ` +
      'места. Сумма вкладов и есть отличие места от среднего.',
    island:
      'Остров тепла считаем так: медиана температуры участков внутри черты города (граница из OpenStreetMap) минус медиана участков в кольце вокруг неё. ' +
      'Медиана, а не среднее, чтобы аэродром или водохранилище не сдвигали число.',
    ndvi:
      'Зелень меряем индексом NDVI по снимкам Sentinel-2: около 0 у асфальта и голой земли, ближе к 1 у густой листвы. Альбедо, доля отражённого света, здесь ' +
      'растёт вместе с жарой: светлее всего голая сухая земля, она же и горячее всего. Поэтому альбедо мы читаем как признак открытого грунта, а не как то, что ' +
      'стоит менять.',
    whatIf: (built, roads) =>
      'Блок «Что если» на панели участка считает ту же модель прямо в браузере: можно добавить деревьев, зелени или светлых покрытий, а где это по ' +
      `модели охлаждает, уменьшить застройку не больше чем на ${built}, а дороги не больше чем на ${roads}; дальше ` +
      '5 % крайних участков города ползунки не идут, чтобы модель не гадала о небывалых сочетаниях. Это связь в данных, а не эксперимент, и речь о ' +
      'поверхности, не о воздухе; альбедо там меняется при тех же зелени и грунте, и тогда светлее значит холоднее, хотя по городу в целом светлое ' +
      'чаще горячее.',
    isotherms: (step) =>
      `Изотермы проведены по сглаженной поверхности через ${step}°. Штриховка в разрезе и на карте показывает фактор, который ` +
      'сильнее всего меняет температуру на этом отрезке.',
    factors: 'Факторы',
    robustness: {
      title: 'Насколько это устойчиво',
      rings:
        'Остров тепла зависит от того, с чем сравнивать. Мы взяли кольцо разной ширины вокруг черты города: если знак и порядок числа держатся, это не ' +
        'выбор кольца.',
      spread: (spread) => ` Разброс между кольцами ${spread}.`,
      ring: (width) => `кольцо до ${width} км`,
      ringValue: (island, inside, outside, count) => `${island}: медиана ${inside} в черте против ${outside} вокруг, ${count} участков в кольце`,
      tooFew: 'мало участков для сравнения',
      groups:
        'Зелень, деревья и голая земля связаны между собой, и модель может делить вклад между ними почти произвольно. Поэтому мы складываем вклады ' +
        'связанных факторов в группы (SHAP это позволяет: вклады складываются) и смотрим, на какую группу приходится больше вклада на участках ' +
        'в черте города. Это доли среднего вклада, а не доли дисперсии.',
      group: (share, mean) => `${share} среднего вклада, в среднем ±${mean}° на участок`,
    },
    modis: {
      title: 'Сверка с MODIS и ночь',
      intro:
        'Замеров температуры поверхности на земле, с которыми можно сравнить всю карту, нет. Поэтому сверяем со вторым спутником NASA, MODIS ' +
        '(участки около 1 км, то же лето). Наши участки по 200 м усреднены до его пикселей.',
      day: (product, time) => `${product}, днём ${time}`,
      match: (r, warmer, bias, rmse, n) =>
        `совпадение рисунка r = ${r}, наша поверхность ${warmer ? 'теплее' : 'холоднее'} на ${bias}, разброс ±${rmse}°, ${n} пикселей`,
      ring: (value, width) => `${value} при кольце ${width} км`,
      warmer: 'город тоже теплее окрестностей',
      cooler: 'город прохладнее окрестностей',
      differs: 'разница города с окрестностями',
      night: (product, time, lead, values, day) => `Ночью (${product}, ${time}) ${lead}: ${values}.${day ? ` Днём по нему же: ${day}.` : ''}`,
      nightNote: 'Landsat ночью не снимает, так что ночной остров тепла мы знаем только с разрешением 1 км.',
    },
    energy: {
      title: 'Физика участка',
      intro: (hour) =>
        `Модель выше статистическая: она ищет связи. Рядом с ней стоит физическая оценка: куда уходит солнечная энергия на каждом участке около ${hour}:00, ` +
        'в ваттах на квадратный метр. Она считается только из данных карты и коэффициентов из статей, ссылки ниже.',
      conditions: (solar, air, humidity, sky, hot, cold) =>
        `Для города взяты средние условия в часы съёмки Landsat по ERA5: солнце ${solar}, воздух ${air}, влажность ${humidity} %. ` +
        `Тепло от неба при этом ${sky}. Самое горячее место города, которое считаем сухим: ${hot}; самое прохладное зелёное, которое испаряет сколько может: ${cold}.`,
      storage:
        'Сколько тепла покрытие запасает к вечеру, по участкам не считаем: только справочные свойства материалов (Oke 1987, таблица 2.1). Тепловая ' +
        'активность показывает, как охотно поверхность берёт тепло вглубь и отдаёт его обратно.',
      surface: (capacity, conductivity, admittance) =>
        `теплоёмкость ${capacity} МДж/(м³·К), теплопроводность ${conductivity} Вт/(м·К), тепловая активность ${admittance} Дж/(м²·К·с½)`,
      limitsLead: 'Упрощения:',
      limits: [
        'Одна модель и один момент: медианная летняя температура поверхности против средней погоды в часы съёмки.',
        'Солнце, воздух и влажность ERA5 одни на весь город (точка около 25 км). Тени от домов и деревьев и ветер не учтены.',
        'Излучательная способность только по NDVI: асфальт и крыши получают 0,97, у настоящих 0,90–0,95. На застройке Rn поэтому чуть занижен.',
        'Формула SEBAL для грунта подобрана на полях и степи. В плотной застройке днём в стены и асфальт уходит до 30–40 % Rn, больше, чем она даёт.',
        'Испарение считается относительно самых горячих и самых прохладных мест своего города, поэтому участки внутри города сравнивать можно, города между собой осторожно.',
      ],
      steps: [
        { name: 'Поглощённое солнце', formula: 'S = (1 − α) · S↓, α: альбедо участка по Sentinel-2, S↓: солнечная радиация ERA5 в часы съёмки', cite: 'Liang 2001' },
        {
          name: 'Излучательная способность',
          formula: 'ε = 0,97 при NDVI < 0,2; 0,99 при NDVI > 0,5; между ними смесь почвы и листвы, Pv = ((NDVI − 0,2) / 0,3)²',
          cite: 'Sobrino и др. 2004',
        },
        {
          name: 'Тепло от поверхности',
          formula: 'L↑ = ε · σ · T⁴, T: температура поверхности по Landsat в кельвинах, σ = 5,67·10⁻⁸ Вт/(м²·К⁴)',
          cite: 'Постоянная Стефана–Больцмана, CODATA',
        },
        {
          name: 'Тепло от неба',
          formula: 'L↓ = 1,24 · (e / Tₐ)^(1/7) · σ · Tₐ⁴, ясное небо; e: давление пара из влажности по формуле Магнуса, Tₐ: воздух ERA5',
          cite: 'Brutsaert 1975',
        },
        { name: 'Остаток, радиационный баланс', formula: 'Rn = S + ε · L↓ − L↑', cite: 'Allen и др. 2007' },
        { name: 'В грунт', formula: 'G = Rn · T(°C) · (0,0038 + 0,0074 · α) · (1 − 0,98 · NDVI⁴)', cite: 'Bastiaanssen 2000, SEBAL' },
        {
          name: 'Испарение',
          formula:
            'LE = EF · (Rn − G), EF = (T горячего − T) / (T горячего − T прохладного), от 0 до 1. Горячее место: самые горячие 5 % из 10 % наименее зелёных участков, прохладное: самые прохладные 5 % из 10 % самых зелёных',
          cite: 'Roerink и др. 2000, S-SEBI',
        },
        { name: 'Горячее и прохладное место', formula: 'опорные участки внутри города, выбранные по NDVI и температуре; то же сделано в SSEB', cite: 'Senay и др. 2007' },
        { name: 'Нагрев воздуха', formula: 'H = Rn − G − LE: что не ушло в грунт и на испарение, греет воздух', cite: 'Bastiaanssen и др. 1998, SEBAL' },
      ],
    },
    limitsTitle: 'Чего карта не знает',
    limits: [
      'Это температура поверхности, а не воздуха. Днём она выше и меняется резче.',
      'Landsat снимает около 11 утра. Вечерний и ночной перегрев на карте не виден; ночной остров тепла выше оценён по MODIS с шагом 1 км.',
      'Вклад фактора показывает связь в данных, а не эксперимент. Факторы связаны между собой: где мало зелени, там обычно плотнее застройка.',
      'Что дают меры, известно из обзоров по другим городам, ссылки у каждой меры. Там речь чаще о воздухе, а не о поверхности, это ориентир, а не прогноз для участка.',
      'Аэродромы и железнодорожные пути горячие из-за покрытия; там карта не советует деревья.',
    ],
    layers: (period, population) =>
      `Слои разных лет: снимки ${period}, покрытие ESA WorldCover 2021, высоты зданий GHSL 2018` +
      (population ? `, население WorldPop ${population}` : '') +
      '.',
  },
);
