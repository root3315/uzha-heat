import { texts } from '../../i18n/locale';

/** Facts for the problem strip, each with its source. From docs/problem.md; air temperatures, not surface. */
export interface ProblemFact {
  figure: string;
  text: string;
  source: string;
  url: string;
}

const URLS = {
  record: 'https://kun.uz/en/news/2026/08/07/july-heat-shatters-temperature-records-across-uzbekistan',
  deaths: 'https://kun.uz/en/news/2025/07/17/uzbekistan-faces-rising-heatwave-deaths-world-bank-report',
  power: 'https://kun.uz/en/news/2024/07/27/uzbekistans-power-consumption-hits-new-peaks-due-to-extreme-heat',
  green: 'https://www.uzdaily.uz/en/president-approves-plans-to-triple-green-zones-in-tashkent/',
};

export const PROBLEM_FACTS = texts<readonly ProblemFact[]>(
  [
    { figure: '+44.3°', text: 'air temperature in Tashkent on 19 July 2026, 0.3° below the city record.', source: 'Uzhydromet', url: URLS.record },
    { figure: '≈20', text: 'heat deaths per 100,000 residents a year, a World Bank estimate.', source: 'World Bank', url: URLS.deaths },
    {
      figure: '11,822 MW',
      text: 'peak load of the power grid on 25 July 2024; in the heat, Tashkent had daytime power cuts.',
      source: 'Ministry of Energy',
      url: URLS.power,
    },
    { figure: '3 m²', text: 'of green space per Tashkent resident; the city aims for 6 m².', source: 'UzDaily', url: URLS.green },
  ],
  [
    { figure: '+44,3°', text: 'воздух в Ташкенте 19 июля 2026, на 0,3° ниже рекорда города.', source: 'Узгидромет', url: URLS.record },
    { figure: '≈20', text: 'смертей от жары на 100 тыс. жителей в год, оценка Всемирного банка.', source: 'Всемирный банк', url: URLS.deaths },
    { figure: '11 822 МВт', text: 'пик энергосистемы 25 июля 2024; в жару в Ташкенте днём отключали свет.', source: 'Минэнерго', url: URLS.power },
    { figure: '3 м²', text: 'зелени на жителя Ташкента, город хочет 6 м².', source: 'UzDaily', url: URLS.green },
  ],
);
