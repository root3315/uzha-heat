import { texts } from '../i18n/locale';

/** Reads a scenario's settings from physics.json; each getter is null when the value is missing or of another type. */
export interface SettingsReader {
  num(key: string): number | null;
  flag(key: string): boolean | null;
  word(key: string): string | null;
  words(key: string): string[] | null;
}

/** An assumption worded from the settings; null when a setting it needs is missing (the file's own text is shown then). */
type Assumption = (s: SettingsReader, percent: (share: number) => string, decimal: (value: number) => string) => string | null;

const sameWords = (words: string[] | null, expected: string[]) => words !== null && words.length === expected.length && expected.every((w) => words.includes(w));
const roadsOnly = (s: SettingsReader) => sameWords(s.words('tiles'), ['road']);
const fromPavingAndBare = (s: SettingsReader) => sameWords(s.words('source'), ['paved', 'bare']);

/** The physics model's names: factor groups of the budget, fluxes, scenarios and their assumptions. */
export const PHYSICS_TEXTS = texts(
  {
    groups: {
      albedo: 'Reflectivity of roofs and paving',
      shade: 'Shade and tree share of greenery',
      transpiration: 'Watering and soil moisture',
      sealing: 'Sealed share of the ground',
      geometry: 'Building height and street canyons',
      storage: 'Heat stored in the built fabric',
      anthropogenic: 'Human-made heat',
      water: 'Open water',
    } as Record<string, string>,
    fluxes: {
      rn: 'Net radiation',
      h: 'Heating the air',
      le: 'Evaporation',
      dqs: 'Stored in roofs, walls and ground',
      qf: 'Human-made heat',
    },
    scenarios: {
      cool_roofs: 'Cool roofs',
      cool_pavements: 'Cool pavements',
      green_roofs: 'Green roofs',
      permeable: 'Permeable paving',
      trees: 'Trees',
      waste_heat: 'Less waste heat',
    } as Record<string, string>,
    assumptions: {
      cool_roofs: {
        albedo: (s, _, d) => (s.num('albedo') === null ? null : `Every treated roof reaches albedo ${d(s.num('albedo') ?? 0)} (an aged coating, not a fresh one).`),
        emissivity: (s, _, d) => (s.num('emissivity') === null ? 'Roof emissivity unchanged.' : `Roof emissivity set to ${d(s.num('emissivity') ?? 0)}.`),
        all_roofs: () => 'All roof area is treated; roof slope and access are ignored.',
        storage: () => 'Heat storage of the roof unchanged: the coating is thin.',
      },
      cool_pavements: {
        albedo: (s, _, d) => (s.num('albedo') === null || !roadsOnly(s) ? null : `Every road reaches albedo ${d(s.num('albedo') ?? 0)}; squares and pavements stay as they are.`),
        emissivity: (s, _, d) => (s.num('emissivity') === null ? 'Pavement emissivity unchanged.' : `Pavement emissivity set to ${d(s.num('emissivity') ?? 0)}.`),
        reflection: () => 'Light reflected onto walls and passers-by is not counted.',
        storage: () => 'Heat storage of the pavement unchanged.',
      },
      trees: {
        share: (s, p) => (s.num('share') === null || !fromPavingAndBare(s) ? null : `Canopy added: ${p(s.num('share') ?? 0)} of each cell, at most what paving and bare ground there allow.`),
        source: (s) => (fromPavingAndBare(s) ? 'The canopy replaces paving and bare ground in proportion to their area.' : null),
        water: (s) => (s.flag('irrigated') ? 'Trees are watered.' : "Trees live on the cell's water: inside the city greenery is watered already."),
        mature: () => 'The canopy is mature: full leaf from day one.',
        airflow: () => 'Roughness and open sky of the cell unchanged; ventilation is not counted.',
      },
      green_roofs: {
        share: (s, p) => (s.num('share') === null ? null : `${p(s.num('share') ?? 0)} of the roof area is greened.`),
        properties: () => "Green roofs behave like the cell's grass: reflectivity, storage, evaporation.",
        water: (s) => (s.flag('irrigated') ? 'Green roofs are watered.' : 'Green roofs are not watered.'),
        soil_moisture: (s, _, d) =>
          s.num('soil_moisture') === null ? "Substrate moisture is the cell's soil moisture." : `Substrate moisture ${d(s.num('soil_moisture') ?? 0)} m³/m³.`,
        sky_view: () => "The roof grass is given the street's view of the sky, which understates its cooling to the sky.",
        structure: () => 'Whether a roof can carry it is not checked.',
      },
      permeable: {
        share: (s, p) => (s.num('share') === null || s.word('to') !== 'grass' ? null : `${p(s.num('share') ?? 0)} of squares and pavements become permeable; roads stay sealed.`),
        properties: (s) => (s.word('to') === 'grass' ? "The new surface is grass pavers and behaves like the cell's grass." : null),
        soil_moisture: (s, _, d) =>
          s.num('soil_moisture') === null ? 'Soil moisture unchanged: no extra rain soaking in.' : `Soil moisture raised to at least ${d(s.num('soil_moisture') ?? 0)} m³/m³.`,
      },
      waste_heat: {
        reduction: (s, p) => (s.num('reduction') === null ? null : `Human-made heat cut by ${p(s.num('reduction') ?? 0)}, all sources alike.`),
        data: () => 'Uses the estimated human-made heat map; only as good as that map.',
        release: () => 'The heat is released at the surface, over roofs, roads and paving.',
      },
    } as Record<string, Record<string, Assumption>>,
  },
  {
    groups: {
      albedo: 'Отражающая способность крыш и покрытий',
      shade: 'Тень и доля деревьев в зелени',
      transpiration: 'Полив и влажность почвы',
      sealing: 'Доля запечатанной земли',
      geometry: 'Высота домов и уличные каньоны',
      storage: 'Тепло, запасённое в застройке',
      anthropogenic: 'Тепло от людей',
      water: 'Открытая вода',
    },
    fluxes: {
      rn: 'Радиационный баланс',
      h: 'Нагрев воздуха',
      le: 'Испарение',
      dqs: 'Запас в крышах, стенах и грунте',
      qf: 'Тепло от людей',
    },
    scenarios: {
      cool_roofs: 'Светлые крыши',
      cool_pavements: 'Светлое покрытие дорог',
      green_roofs: 'Зелёные крыши',
      permeable: 'Проницаемое покрытие',
      trees: 'Деревья',
      waste_heat: 'Меньше бросового тепла',
    },
    assumptions: {
      cool_roofs: {
        albedo: (s, _, d) => (s.num('albedo') === null ? null : `Каждая обработанная крыша получает альбедо ${d(s.num('albedo') ?? 0)} (состаренное покрытие, не свежее).`),
        emissivity: (s, _, d) => (s.num('emissivity') === null ? 'Излучательная способность крыш не меняется.' : `Излучательная способность крыш ${d(s.num('emissivity') ?? 0)}.`),
        all_roofs: () => 'Обрабатывается вся площадь крыш; уклон и доступ не учитываются.',
        storage: () => 'Запас тепла крыши не меняется: покрытие тонкое.',
      },
      cool_pavements: {
        albedo: (s, _, d) => (s.num('albedo') === null || !roadsOnly(s) ? null : `Все дороги получают альбедо ${d(s.num('albedo') ?? 0)}; площадки и тротуары остаются как есть.`),
        emissivity: (s, _, d) => (s.num('emissivity') === null ? 'Излучательная способность покрытия не меняется.' : `Излучательная способность покрытия ${d(s.num('emissivity') ?? 0)}.`),
        reflection: () => 'Свет, отражённый на стены и прохожих, не учитывается.',
        storage: () => 'Запас тепла покрытия не меняется.',
      },
      trees: {
        share: (s, p) => (s.num('share') === null || !fromPavingAndBare(s) ? null : `Кроны добавлены на ${p(s.num('share') ?? 0)} площади участка, но не больше, чем там покрытий и голого грунта.`),
        source: (s) => (fromPavingAndBare(s) ? 'Кроны заменяют покрытия и голый грунт пропорционально их площади.' : null),
        water: (s) => (s.flag('irrigated') ? 'Деревья поливают.' : 'Деревья живут на воде участка: в черте города зелень и так поливают.'),
        mature: () => 'Кроны взрослые: полная листва с первого дня.',
        airflow: () => 'Шероховатость и открытость неба участка не меняются; проветривание не учитывается.',
      },
      green_roofs: {
        share: (s, p) => (s.num('share') === null ? null : `Озеленено ${p(s.num('share') ?? 0)} площади крыш.`),
        properties: () => 'Зелёная крыша ведёт себя как трава участка: отражение, запас тепла, испарение.',
        water: (s) => (s.flag('irrigated') ? 'Зелёные крыши поливают.' : 'Зелёные крыши не поливают.'),
        soil_moisture: (s, _, d) =>
          s.num('soil_moisture') === null ? 'Влажность субстрата равна влажности почвы участка.' : `Влажность субстрата ${d(s.num('soil_moisture') ?? 0)} м³/м³.`,
        sky_view: () => 'Трава на крыше видит небо как улица внизу, так что её охлаждение к небу занижено.',
        structure: () => 'Выдержит ли крыша, не проверяется.',
      },
      permeable: {
        share: (s, p) => (s.num('share') === null || s.word('to') !== 'grass' ? null : `${p(s.num('share') ?? 0)} площадок и тротуаров становятся проницаемыми; дороги остаются запечатанными.`),
        properties: (s) => (s.word('to') === 'grass' ? 'Новое покрытие — газонная решётка, ведёт себя как трава участка.' : null),
        soil_moisture: (s, _, d) =>
          s.num('soil_moisture') === null ? 'Влажность почвы не меняется: лишний дождь не впитывается.' : `Влажность почвы поднята минимум до ${d(s.num('soil_moisture') ?? 0)} м³/м³.`,
      },
      waste_heat: {
        reduction: (s, p) => (s.num('reduction') === null ? null : `Тепло от людей сокращено на ${p(s.num('reduction') ?? 0)}, все источники одинаково.`),
        data: () => 'Используется оценочная карта тепла от людей; результат не точнее этой карты.',
        release: () => 'Тепло выделяется у поверхности, на крышах, дорогах и покрытиях.',
      },
    },
  },
);
