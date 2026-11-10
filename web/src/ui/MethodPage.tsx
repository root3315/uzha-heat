import type { EnergyMethod } from '../data/contract';
import type { CityModel } from '../domain/cityModel';
import { formatWatts } from '../domain/energy';
import { formatDeg, formatNumber, plural } from '../domain/format';
import { Link } from './Link';
import { toolHref } from './routing';

const SOURCE_OF: Record<string, string> = {
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
};

interface Step {
  name: string;
  formula: string;
  cite: string;
  url: string;
}

/** Each step of the energy balance, its formula and the paper it comes from. */
const ENERGY_STEPS: Step[] = [
  {
    name: 'Поглощённое солнце',
    formula: 'S = (1 − α) · S↓, α: альбедо участка по Sentinel-2, S↓: солнечная радиация ERA5 в часы съёмки',
    cite: 'Liang 2001',
    url: 'https://doi.org/10.1016/S0034-4257(00)00205-4',
  },
  {
    name: 'Излучательная способность',
    formula: 'ε = 0,97 при NDVI < 0,2; 0,99 при NDVI > 0,5; между ними смесь почвы и листвы, Pv = ((NDVI − 0,2) / 0,3)²',
    cite: 'Sobrino и др. 2004',
    url: 'https://doi.org/10.1016/j.rse.2004.02.003',
  },
  {
    name: 'Тепло от поверхности',
    formula: 'L↑ = ε · σ · T⁴, T: температура поверхности по Landsat в кельвинах, σ = 5,67·10⁻⁸ Вт/(м²·К⁴)',
    cite: 'Постоянная Стефана–Больцмана, CODATA',
    url: 'https://physics.nist.gov/cgi-bin/cuu/Value?sigma',
  },
  {
    name: 'Тепло от неба',
    formula: 'L↓ = 1,24 · (e / Tₐ)^(1/7) · σ · Tₐ⁴, ясное небо; e: давление пара из влажности по формуле Магнуса, Tₐ: воздух ERA5',
    cite: 'Brutsaert 1975',
    url: 'https://doi.org/10.1029/WR011i005p00742',
  },
  {
    name: 'Остаток, радиационный баланс',
    formula: 'Rn = S + ε · L↓ − L↑',
    cite: 'Allen и др. 2007',
    url: 'https://doi.org/10.1061/(ASCE)0733-9437(2007)133:4(380)',
  },
  {
    name: 'В грунт',
    formula: 'G = Rn · T(°C) · (0,0038 + 0,0074 · α) · (1 − 0,98 · NDVI⁴)',
    cite: 'Bastiaanssen 2000, SEBAL',
    url: 'https://doi.org/10.1016/S0022-1694(99)00202-4',
  },
  {
    name: 'Испарение',
    formula:
      'LE = EF · (Rn − G), EF = (T горячего − T) / (T горячего − T прохладного), от 0 до 1. Горячее место: самые горячие 5 % из 10 % наименее зелёных участков, прохладное: самые прохладные 5 % из 10 % самых зелёных',
    cite: 'Roerink и др. 2000, S-SEBI',
    url: 'https://doi.org/10.1016/S1464-1909(99)00128-8',
  },
  {
    name: 'Горячее и прохладное место',
    formula: 'опорные участки внутри города, выбранные по NDVI и температуре; то же сделано в SSEB',
    cite: 'Senay и др. 2007',
    url: 'https://doi.org/10.3390/s7060979',
  },
  {
    name: 'Нагрев воздуха',
    formula: 'H = Rn − G − LE: что не ушло в грунт и на испарение, греет воздух',
    cite: 'Bastiaanssen и др. 1998, SEBAL',
    url: 'https://doi.org/10.1016/S0022-1694(98)00253-4',
  },
];

function EnergySection({ energy }: { energy: EnergyMethod }) {
  return (
    <>
      <h2 className="method__subtitle">Физика участка</h2>
      <p>
        Модель выше статистическая: она ищет связи. Рядом с ней стоит физическая оценка: куда уходит солнечная энергия на каждом участке около{' '}
        {energy.localHour}:00, в ваттах на квадратный метр. Она считается только из данных карты и коэффициентов из статей, ссылки ниже.
      </p>
      <p>
        Для города взяты средние условия в часы съёмки Landsat по ERA5: солнце {formatWatts(energy.solarWm2)}, воздух {formatDeg(energy.airC)}, влажность{' '}
        {formatNumber(energy.humidityPct, 0)} %. Тепло от неба при этом {formatWatts(energy.longwaveDownWm2)}. Самое горячее место города, которое считаем сухим:{' '}
        {formatDeg(energy.hotAnchorC)}; самое прохладное зелёное, которое испаряет сколько может: {formatDeg(energy.coldAnchorC)}.
      </p>
      <dl className="method__factors">
        {ENERGY_STEPS.map((step) => (
          <div key={step.name}>
            <dt>{step.name}</dt>
            <dd>
              {step.formula}.{' '}
              <a className="text-link" href={step.url} target="_blank" rel="noopener">
                {step.cite}&nbsp;↗
              </a>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        Сколько тепла покрытие запасает к вечеру, по участкам не считаем: только справочные свойства материалов (Oke 1987, таблица 2.1). Тепловая
        активность показывает, как охотно поверхность берёт тепло вглубь и отдаёт его обратно.{' '}
        <a className="text-link" href="https://doi.org/10.4324/9780203407219" target="_blank" rel="noopener">
          Oke 1987&nbsp;↗
        </a>
      </p>
      <dl className="method__factors">
        {energy.surfaces.map((surface) => (
          <div key={surface.key}>
            <dt>{surface.label}</dt>
            <dd>
              теплоёмкость {formatNumber(surface.heatCapacity, 2)} МДж/(м³·К), теплопроводность {formatNumber(surface.conductivity, 2)} Вт/(м·К), тепловая
              активность {formatNumber(surface.admittance, 0)} Дж/(м²·К·с½)
            </dd>
          </div>
        ))}
      </dl>
      <p>Упрощения:</p>
      <ul className="method__limits">
        <li>Одна модель и один момент: медианная летняя температура поверхности против средней погоды в часы съёмки.</li>
        <li>Солнце, воздух и влажность ERA5 одни на весь город (точка около 25 км). Тени от домов и деревьев и ветер не учтены.</li>
        <li>Излучательная способность только по NDVI: асфальт и крыши получают 0,97, у настоящих 0,90–0,95. На застройке Rn поэтому чуть занижен.</li>
        <li>Формула SEBAL для грунта подобрана на полях и степи. В плотной застройке днём в стены и асфальт уходит до 30–40 % Rn, больше, чем она даёт.</li>
        <li>Испарение считается относительно самых горячих и самых прохладных мест своего города, поэтому участки внутри города сравнивать можно, города между собой осторожно.</li>
      </ul>
    </>
  );
}

/** How the map was made, in the same plain voice as the map. Every number comes from the city's data. */
export function MethodPage({ model }: { model: CityModel }) {
  const { detail, levels } = model;
  const { grid, period, features, model: fit, city } = detail;
  const n = features.length;
  const step = (levels.thresholds[1] ?? 0) - (levels.thresholds[0] ?? 0);
  return (
    <main className="method">
      <h1 className="method__title">Как это посчитано</h1>
      <p className="method__lead">
        {city.name}. <Link className="text-link" href={toolHref(city.id)}>Вернуться к карте</Link>
      </p>

      <p>
        {city.name} разбит на участки {grid.cellSizeM} × {grid.cellSizeM} м, их {formatNumber(grid.count, 0)}. Для каждого есть температура
        поверхности летом ({period.label}, медиана {period.lstScenes} {plural(period.lstScenes, ['снимка', 'снимков', 'снимков'])} Landsat 8/9 без
        облаков, снимки NASA/USGS) и {n} {plural(n, ['фактор', 'фактора', 'факторов'])}, перечисленных ниже.
      </p>
      <p>
        Модель {fit.type} учится предсказывать температуру участка по его факторам. Проверка пространственная: город режется на блоки, и модель
        оценивают на тех, которых она не видела. На такой проверке R² {formatNumber(fit.r2Cv, 2)}, средняя ошибка {formatDeg(fit.maeCv)}.
      </p>
      <p>
        Вклад каждого фактора в градусах считает метод SHAP: от средней оценки по городу, {formatDeg(fit.baseValue)}, до температуры конкретного
        места. Сумма вкладов и есть отличие места от среднего.
      </p>
      <p>
        Остров тепла считаем так: медиана температуры участков внутри черты города (граница из OpenStreetMap) минус медиана участков в кольце вокруг неё.
        Медиана, а не среднее, чтобы аэродром или водохранилище не сдвигали число.
      </p>
      <p>
        Зелень меряем индексом NDVI по снимкам Sentinel-2: около 0 у асфальта и голой земли, ближе к 1 у густой листвы. Альбедо, доля отражённого света, здесь
        растёт вместе с жарой: светлее всего голая сухая земля, она же и горячее всего. Поэтому альбедо мы читаем как признак открытого грунта, а не как то, что
        стоит менять.
      </p>
      <p>
        Изотермы проведены по сглаженной поверхности через {formatNumber(step, 0)}°. Штриховка в разрезе и на карте показывает фактор, который
        сильнее всего меняет температуру на этом отрезке.
      </p>

      <h2 className="method__subtitle">Факторы</h2>
      <dl className="method__factors">
        {features.map((feature) => (
          <div key={feature.key}>
            <dt>{feature.label}</dt>
            <dd>{[feature.unit, SOURCE_OF[feature.key]].filter(Boolean).join(', ')}</dd>
          </div>
        ))}
      </dl>

      {detail.energy && <EnergySection energy={detail.energy} />}

      <h2 className="method__subtitle">Чего карта не знает</h2>
      <ul className="method__limits">
        <li>Это температура поверхности, а не воздуха. Днём она выше и меняется резче.</li>
        <li>Landsat снимает около 11 утра. Вечерний и ночной перегрев здесь не виден.</li>
        <li>Вклад фактора показывает связь в данных, а не эксперимент. Факторы связаны между собой: где мало зелени, там обычно плотнее застройка.</li>
        <li>Что дают меры, известно из обзоров по другим городам, ссылки у каждой меры. Там речь чаще о воздухе, а не о поверхности, это ориентир, а не прогноз для участка.</li>
        <li>Аэродромы и железнодорожные пути горячие из-за покрытия; там карта не советует деревья.</li>
      </ul>
    </main>
  );
}
