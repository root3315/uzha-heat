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
      'The "What if" block in a cell\'s panel runs the same model in the browser: you can add trees or greenery, and where the model ' +
      `says it cools, reduce built-up cover by at most ${built} and roads by at most ${roads}; the sliders stop at the ` +
      "city's outermost 5% of cells, so the model does not guess at combinations it has never seen. This is association in the data, not an experiment, and it is about the " +
      'surface, not the air. There is no albedo slider, for the reason above: here albedo marks open ground, not a roof one could lighten.',
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
      budget: (observed: string) =>
        `Where the difference comes from. On average the surface inside the line is ${observed} warmer than around it (a mean this time, ` +
        'so the parts add up). The model splits that by group of factors. "Other" is what the groups leave unexplained: the observed ' +
        'difference minus their sum, that is, where the model misses the satellite. It is a remainder, not a heat source of its own.',
      other: 'Other, unexplained',
      reference: (all: string) =>
        `The reference can also be chosen by rule rather than as the whole ring: ring cells at the city's height (within 50 m), not by water ` +
        `(200 m), not irrigated fields (NDVI above 0.45 with under 10% built-up) and not mostly bare ground (over 50%). Against that reference ` +
        `the heat island is ${all}. Each rule alone:`,
      rule: { water: 'without cells by water', irrigated: 'without irrigated fields', bare: 'without bare ground', height: 'without cells at another height' },
      ruleValue: (island: string, removed: string) => `${island}, ${removed} ring cells left out`,
      referenceNote:
        'Irrigated fields are the coolest surface around these oasis cities. Compared with them the city stands out more; compared with dry land, less. Both are true; which one matters depends on the question.',
    },
    modis: {
      title: 'Check against MODIS, and the night',
      intro:
        'There are no ground measurements of surface temperature to compare the whole map with. So we compare with a second NASA satellite, MODIS ' +
        '(cells of about 1 km, the same summers). Our 200 m cells are averaged to its pixels. The match inside the city outline alone shows the map finds the heat within the city, not only the city against the countryside.',
      day: (product: string, time: string) => `${product}, day ${time}`,
      match: (r: string, warmer: boolean, bias: string, rmse: string, n: string) =>
        `pattern match r = ${r}, our surface is ${warmer ? 'warmer' : 'cooler'} by ${bias}, spread ±${rmse}°, ${n} pixels`,
      inside: (r: string, n: string) => `; inside the city outline alone r = ${r} on ${n} pixels`,
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
    physics: {
      title: 'Physics: the energy balance',
      intro:
        'Next to the statistical model there is a physical one. Each cell is split into surfaces: trees, grass, bare ground, roofs, roads, paving and water. ' +
        'For each surface the model finds the temperature at which the energy at the Landsat overpass balances: sunlight and heat from the sky coming in, ' +
        'heating of the air, evaporation and heat stored in roofs, walls and ground going out, plus human-made heat. Seven parameters for the whole city ' +
        '(how readily leaves and soil give off water, how much heat the built fabric takes, an offset of the air temperature and others), each within its ' +
        'range from the literature, are fitted to the Landsat temperature.',
      skillLead: 'Scored the same way as the model above, on blocks of the city it has not seen:',
      main: 'Statistical model (above)',
      alone: 'Physics alone',
      hybrid: 'Physics with a learned correction',
      skill: (r2: string, error: string, inside: string | null) => `R² ${r2}, mean error ${error}` + (inside ? `; inside the city line R² ${inside}` : ''),
      verdict: {
        less:
          'Physics alone explains less than the statistical model. It knows only what its equations and inputs contain, and the inputs are coarse: land cover, ' +
          'building heights, one weather point for the whole city. Its use is elsewhere: it says why, in watts, and it can try changes the data have never seen.',
        same: 'Physics alone explains about as much as the statistical model, while saying why, in watts.',
        more: 'Physics alone explains more than the statistical model here.',
      },
      hybridNote: 'The correction is a small boosted model trained on what the physics misses, on the training blocks only.',
      fluxesLead: 'Where the energy goes at the Landsat overpass, mean over the cells, inside the city line against the ring around it:',
      flux: (inside: string, ring: string) => `${inside} inside, ${ring} around`,
      budget: (observed: string, inside: string, ring: string) =>
        `The physics splits the heat island too. On average the surface inside the line is ${observed} warmer than the ring (computed on ${inside} cells inside ` +
        `and ${ring} in the ring, drawn evenly across temperatures). Each group of physical factors is set to the ring's typical value, and its part is averaged ` +
        'over every order of doing so (Shapley values), so the parts add up.',
      other: 'Other, unexplained',
      otherNote: (gap: string) =>
        `Other is what the groups leave: where the physics misses the satellite (${gap} of it), and what stays when every group is at the ring's value, such as the ` +
        'air temperature at the height of each cell. It is a remainder, not a heat source of its own.',
      scenariosLead: (low: number, high: number, replicates: number) =>
        'Physics estimate: what each measure would do if applied to every suitable surface inside the city at once. Two numbers: the change on the treated ' +
        `surfaces themselves and over the whole city. In brackets, ${low}–${high}% of the spread over ${replicates} refits of the parameters on resampled blocks of the city.`,
      scenario: (treated: string | null, whole: string, area: string | null) =>
        (treated ? `treated surfaces ${treated}, ` : '') + `whole city ${whole}` + (area ? `; ${area} of the city's area treated` : ''),
      range: (mid: string, low: string, high: string) => `${mid} (${low} … ${high})`,
      caveat:
        'Physics estimate of the surface at about 11:00, not of the air, and not a forecast: it is only as good as the skill above. The assumptions are listed under each measure.',
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
      'Блок «Что если» на панели участка считает ту же модель прямо в браузере: можно добавить деревьев или зелени, а где это по ' +
      `модели охлаждает, уменьшить застройку не больше чем на ${built}, а дороги не больше чем на ${roads}; дальше ` +
      '5 % крайних участков города ползунки не идут, чтобы модель не гадала о небывалых сочетаниях. Это связь в данных, а не эксперимент, и речь о ' +
      'поверхности, не о воздухе. Ползунка альбедо нет по той же причине: здесь альбедо говорит об открытом грунте, а не о крыше, которую можно осветлить.',
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
      budget: (observed) =>
        `Откуда берётся разница. В среднем поверхность в черте города теплее, чем вокруг, на ${observed} (здесь среднее, ` +
        'чтобы части складывались). Модель делит её по группам факторов. «Прочее» — то, что группы не объясняют: наблюдаемая разница ' +
        'минус их сумма, то есть то, где модель расходится со спутником. Это остаток, а не отдельный источник тепла.',
      other: 'Прочее, необъяснённое',
      reference: (all) =>
        `Эталон можно выбрать и по правилу, а не брать всё кольцо: участки кольца на высоте города (в пределах 50 м), не у воды (200 м), ` +
        `не орошаемые поля (NDVI выше 0,45 при застройке меньше 10 %) и не преимущественно голый грунт (больше 50 %). Против такого эталона ` +
        `остров тепла ${all}. Каждое правило по отдельности:`,
      rule: { water: 'без участков у воды', irrigated: 'без орошаемых полей', bare: 'без голого грунта', height: 'без участков на другой высоте' },
      ruleValue: (island, removed) => `${island}, исключено ${removed} участков кольца`,
      referenceNote:
        'Орошаемые поля — самая прохладная поверхность вокруг этих городов-оазисов. На их фоне город выделяется сильнее, на фоне сухой земли — слабее. Верно и то и другое; что важнее, зависит от вопроса.',
    },
    modis: {
      title: 'Сверка с MODIS и ночь',
      intro:
        'Замеров температуры поверхности на земле, с которыми можно сравнить всю карту, нет. Поэтому сверяем со вторым спутником NASA, MODIS ' +
        '(участки около 1 км, то же лето). Наши участки по 200 м усреднены до его пикселей. Совпадение только внутри границы города показывает, что карта находит жару внутри города, а не только разницу города и пригорода.',
      day: (product, time) => `${product}, днём ${time}`,
      match: (r, warmer, bias, rmse, n) =>
        `совпадение рисунка r = ${r}, наша поверхность ${warmer ? 'теплее' : 'холоднее'} на ${bias}, разброс ±${rmse}°, ${n} пикселей`,
      inside: (r, n) => `; только внутри границы города r = ${r} на ${n} пикселях`,
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
    physics: {
      title: 'Физика: энергетический баланс',
      intro:
        'Рядом со статистической моделью стоит физическая. Каждый участок разбит на поверхности: деревья, трава, голый грунт, крыши, дороги, покрытия и вода. ' +
        'Для каждой модель находит температуру, при которой сходится энергия в момент съёмки Landsat: приходят солнце и тепло от неба, уходят нагрев ' +
        'воздуха, испарение и тепло, запасённое в крышах, стенах и грунте, плюс тепло от людей. Семь параметров на весь город (насколько охотно листья ' +
        'и почва отдают воду, сколько тепла берёт застройка, поправка температуры воздуха и другие), каждый в пределах из литературы, подобраны по температуре Landsat.',
      skillLead: 'Проверка та же, что у модели выше, на блоках города, которых модель не видела:',
      main: 'Статистическая модель (выше)',
      alone: 'Только физика',
      hybrid: 'Физика с обученной поправкой',
      skill: (r2, error, inside) => `R² ${r2}, средняя ошибка ${error}` + (inside ? `; в черте города R² ${inside}` : ''),
      verdict: {
        less:
          'Одна физика объясняет меньше, чем статистическая модель. Она знает только то, что есть в её уравнениях и данных, а данные грубые: покрытие земли, ' +
          'высоты домов, одна точка погоды на весь город. Её польза в другом: она объясняет почему, в ваттах, и может проверить изменения, которых в данных не было.',
        same: 'Одна физика объясняет примерно столько же, сколько статистическая модель, и при этом говорит почему, в ваттах.',
        more: 'Здесь одна физика объясняет больше, чем статистическая модель.',
      },
      hybridNote: 'Поправка — небольшая модель бустинга, обученная на том, что упускает физика, только на обучающих блоках.',
      fluxesLead: 'Куда уходит энергия в момент съёмки Landsat, среднее по участкам, в черте города против кольца вокруг:',
      flux: (inside, ring) => `${inside} в черте, ${ring} вокруг`,
      budget: (observed, inside, ring) =>
        `Физика тоже делит остров тепла. В среднем поверхность в черте теплее кольца на ${observed} (посчитано на ${inside} участках в черте ` +
        `и ${ring} в кольце, взятых равномерно по температуре). Каждая группа физических факторов ставится на типичное для кольца значение, и её доля ` +
        'усредняется по всем порядкам такой замены (значения Шепли), поэтому части складываются.',
      other: 'Прочее, необъяснённое',
      otherNote: (gap) =>
        `Прочее — то, что оставляют группы: где физика расходится со спутником (${gap} из него), и что остаётся, когда все группы на уровне кольца, например ` +
        'температура воздуха на высоте участка. Это остаток, а не отдельный источник тепла.',
      scenariosLead: (low, high, replicates) =>
        'Физическая оценка: что дала бы каждая мера, если применить её сразу на всех подходящих поверхностях в черте города. Два числа: изменение на самих ' +
        `обработанных поверхностях и по всему городу. В скобках ${low}–${high} % разброса по ${replicates} переподборам параметров на перевыбранных блоках города.`,
      scenario: (treated, whole, area) =>
        (treated ? `обработанные поверхности ${treated}, ` : '') + `весь город ${whole}` + (area ? `; обработано ${area} площади города` : ''),
      range: (mid, low, high) => `${mid} (${low} … ${high})`,
      caveat:
        'Физическая оценка поверхности около 11:00, не воздуха, и не прогноз: она точна настолько, насколько точна проверка выше. Допущения перечислены под каждой мерой.',
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
