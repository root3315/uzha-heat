import { texts } from '../i18n/locale';
import { genitive } from '../i18n/russian';

const NBSP = ' ';

export const ENERGY_TEXTS = texts(
  {
    watt: `${NBSP}W/m²`,
    sinks: { le: 'evaporation', h: 'heating the air', g: 'into the ground' },
    verdict: {
      dry: 'Here almost all the sunlight goes into heat: there is nothing to evaporate.',
      little: 'Little evaporates; most of the heat goes into the air.',
      even: 'The heat splits almost evenly: part goes into evaporation, part heats the air.',
      wet: 'Here most of the sunlight goes into evaporation: plants and moist soil cool themselves.',
    },
    greener: (ratio: string, here: string, green: string) =>
      `The air here is heated ${ratio} times more than over the city's greenest cells: ${here} against ${green}.`,
    asGreen: (green: string) => `About the same as the city's greenest cells: there ${green} goes into heating the air.`,
    storage: {
      built: (times: string) => `Asphalt and concrete soak up ${times} times more heat than dry soil and give it back in the evening.`,
      bare: (times: string) => `Dry soil soaks up about ${times} times less heat than asphalt: by day it is hot on top, but it cools faster in the evening.`,
      green: (times: string) =>
        `Moist soil soaks up the most heat, about ${times} times more than dry soil, but by day the sunlight goes into evaporation, and by evening there is little to store.`,
    },
    caveat: (hour: number, solar: string) =>
      `An estimate from one model for a clear day around ${hour}:00. Sunlight, ${solar}, and air from the ERA5 weather reanalysis are the same for the whole city; ` +
      `the share going into evaporation comes from each cell's temperature between the city's hottest and coolest places.`,
    cityLine: (city: string, hot: string, green: string, hotShare: string, greenShare: string) =>
      `The hottest cells of ${city} give ${hot} to the air, the greenest ${green}: ` +
      `evaporation takes ${hotShare} of the energy in the first and ${greenShare} in the second.`,
  },
  {
    watt: `${NBSP}Вт/м²`,
    sinks: { le: 'испарение', h: 'нагрев воздуха', g: 'в грунт' },
    verdict: {
      dry: 'Здесь почти всё солнце уходит в нагрев: испаряться нечему.',
      little: 'Испаряется мало, большая часть тепла уходит в воздух.',
      even: 'Тепло делится почти поровну: часть уходит на испарение, часть греет воздух.',
      wet: 'Здесь большая часть солнца уходит на испарение: зелень и влажная почва остужают сами себя.',
    },
    greener: (ratio, here, green) =>
      `Воздух здесь греется в${NBSP}${ratio} раза сильнее, чем на самых зелёных участках города: ` + `${here} против ${green}.`,
    asGreen: (green) => `Почти как на самых зелёных участках города: там на нагрев воздуха уходит ${green}.`,
    storage: {
      built: (times) => `Асфальт и бетон набирают в ${times} раза больше тепла, чем сухой грунт, и отдают его вечером.`,
      bare: (times) => `Сухой грунт набирает примерно в ${times} раза меньше тепла, чем асфальт: днём он горячий сверху, но вечером остывает быстрее.`,
      green: (times) =>
        `Влажная почва набирает больше всех тепла, примерно в ${times} раза больше сухого грунта, но днём солнце уходит на испарение, и к вечеру запасать почти нечего.`,
    },
    caveat: (hour, solar) =>
      `Оценка по одной модели для ясного дня около ${hour}:00. Солнце, ${solar}, и воздух по реанализу погоды ERA5 одни на весь город; ` +
      `сколько уходит на испарение, считаем по температуре участка между самым горячим и самым прохладным местом города.`,
    cityLine: (city, hot, green, hotShare, greenShare) =>
      `Самые горячие участки ${genitive(city)} отдают воздуху ${hot}, самые зелёные ${green}: ` +
      `на испарение у первых уходит ${hotShare} энергии, у вторых ${greenShare}.`,
  },
);
