import { texts } from '../i18n/locale';
import type { MapLayer } from '../domain/layers';

const NBSP = ' ';

export const LAYER_TEXTS = texts(
  {
    switchLabel: 'What the map shows',
    /** On the switch: short. */
    short: { lst: 'Temperature', h: 'Air heating', le: 'Evaporation', g: 'Ground', night: 'Night' } as Record<MapLayer, string>,
    /** Over the legend: what the colour is. */
    name: {
      lst: 'Surface temperature',
      h: 'Heat into the air',
      le: 'Evaporation',
      g: 'Stored in the ground',
      night: 'Surface at night',
    } as Record<MapLayer, string>,
    /** One plain line under the legend; `hour` is the local hour of the Landsat overpass. */
    explain: {
      h: (hour: number) => `Of the sunlight at about ${hour}:00, the part that goes into heating the air: the more, the hotter the street.`,
      le: (hour: number) => `Of the sunlight at about ${hour}:00, the part spent on evaporation: trees, grass and wet soil cool themselves with it.`,
      g: (hour: number) =>
        `Of the sunlight at about ${hour}:00, the part going into the ground, asphalt and walls: the city gives it back after sunset.`,
    },
    nightExplain: (period: string) =>
      `NASA's MODIS sensor on the Aqua satellite, at about 01:30, ${period} median. The squares are its 1${NBSP}km pixels, as the satellite sees them. They show where the city does not cool down at night.`,
    perSquareMetre: `W/m²`,
    /** The readout under the pointer. */
    readout: { h: 'into the air', le: 'evaporation', g: 'into the ground', night: 'at night, MODIS 1 km' },
    below: (value: string) => `below ${value}`,
    above: (value: string) => `${value} and up`,
  },
  {
    switchLabel: 'Что показывает карта',
    short: { lst: 'Температура', h: 'Нагрев воздуха', le: 'Испарение', g: 'В грунт', night: 'Ночь' },
    name: {
      lst: 'Температура поверхности',
      h: 'Тепло в воздух',
      le: 'Испарение',
      g: 'Уходит в грунт',
      night: 'Поверхность ночью',
    },
    explain: {
      h: (hour) => `Сколько солнца около ${hour}:00 уходит на нагрев воздуха: чем больше, тем жарче на улице.`,
      le: (hour) => `Сколько солнца около ${hour}:00 уходит на испарение: так деревья, трава и влажная почва остужают сами себя.`,
      g: (hour) => `Сколько солнца около ${hour}:00 уходит в грунт, асфальт и стены: после заката город отдаёт это тепло обратно.`,
    },
    nightExplain: (period) =>
      `Прибор MODIS на спутнике NASA Aqua, около 01:30, медиана за ${period}. Квадраты на карте: пиксели 1${NBSP}км, как их видит спутник. Видно, где город не остывает ночью.`,
    perSquareMetre: `Вт/м²`,
    readout: { h: 'в воздух', le: 'испарение', g: 'в грунт', night: 'ночью, MODIS 1 км' },
    below: (value) => `ниже ${value}`,
    above: (value) => `${value} и выше`,
  },
);
