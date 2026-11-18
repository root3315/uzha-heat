import { texts } from '../i18n/locale';
import { pluralEn, pluralRu } from '../i18n/plural';
import { locative } from '../i18n/russian';

const NBSP = ' ';

export const WEATHER_TEXTS = texts(
  {
    wind: `${NBSP}m/s`,
    percent: '%',
    solar: `${NBSP}kWh`,
    labels: {
      wind: 'wind',
      airMax: 'air, daily maximum',
      airMean: 'air, mean',
      humidity: 'humidity',
      solar: 'sunlight per m² a day',
      cloud: 'cloud cover',
    },
    overpass: (days: number, daysText: string, hour: number, wind: string, air: string, humidity: string, cloud: string) =>
      `On the ${daysText} ${pluralEn(days, ['day', 'days'])} of Landsat overpasses, around ${hour}:00: wind ${wind}, air ${air}, ` +
      `humidity ${humidity}, cloud cover ${cloud}.`,
    source: (source: string, period: string) => `${source}, ${period}: one grid point about 25${NBSP}km across, near the city centre.`,
    calmest: (calm: string, calmWind: string, windy: string, windyWind: string) =>
      `The wind is weakest in ${calm}: ${calmWind} against ${windyWind} in ${windy}. ` +
      'The weaker the wind, the less heat it carries off hot roofs and asphalt.',
    hottestAir: (city: string, air: string) => `The air is hottest in ${city}: daily highs average ${air}.`,
  },
  {
    wind: `${NBSP}м/с`,
    percent: `${NBSP}%`,
    solar: `${NBSP}кВт·ч`,
    labels: {
      wind: 'ветер',
      airMax: 'воздух, дневной максимум',
      airMean: 'воздух, среднее',
      humidity: 'влажность',
      solar: 'солнце за день на м²',
      cloud: 'облачность',
    },
    overpass: (days, daysText, hour, wind, air, humidity, cloud) =>
      `В ${daysText} ${pluralRu(days, ['день', 'дня', 'дней'])} съёмки Landsat, около ${hour}:00: ветер ${wind}, воздух ${air}, ` +
      `влажность ${humidity}, облачность ${cloud}.`,
    source: (source, period) => `${source}, ${period}: одна точка сетки около 25${NBSP}км у центра города.`,
    calmest: (calm, calmWind, windy, windyWind) =>
      `Слабее всего ветер в ${locative(calm)}: ${calmWind} против ${windyWind} ` +
      `в ${locative(windy)}. Чем слабее ветер, тем меньше тепла он уносит с нагретых крыш и асфальта.`,
    hottestAir: (city, air) => `Жарче всего воздух в ${locative(city)}: днём в среднем до ${air}.`,
  },
);
