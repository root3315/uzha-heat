import type { FacilityType } from '../data/contract';
import { texts } from '../i18n/locale';
import { pluralEn, pluralRu } from '../i18n/plural';

export const PEOPLE_TEXTS = texts(
  {
    facilities: { school: 'school', kindergarten: 'kindergarten', clinic: 'clinic', hospital: 'hospital' } as Record<FacilityType, string>,
    thousands: (figure: string) => `${figure} thousand`,
    people: (count: number) => pluralEn(count, ['person', 'people']),
    sparse: (perCell: string, cityFigure: string) =>
      `The hottest cells here have almost no housing: on average ${perCell} per cell against ${cityFigure} across the city.`,
    caveat: (year: number) => `Residents: WorldPop ${year} estimate. It is a model built from the census and imagery of buildings, not a count of people.`,
  },
  {
    facilities: { school: 'школа', kindergarten: 'детский сад', clinic: 'поликлиника', hospital: 'больница' },
    thousands: (figure) => `${figure} тыс.`,
    people: (count) => pluralRu(count, ['человек', 'человека', 'человек']),
    sparse: (perCell, cityFigure) => `Самые горячие участки здесь почти без жилья: в среднем ${perCell} на участок против ${cityFigure} по городу.`,
    caveat: (year) => `Число жителей: оценка WorldPop ${year}. Это модель по переписи и снимкам застройки, а не подсчёт людей.`,
  },
);
