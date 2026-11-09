/** Facts for the problem strip, each with its source. From docs/problem.md; air temperatures, not surface. */
export interface ProblemFact {
  figure: string;
  text: string;
  source: string;
  url: string;
}

export const PROBLEM_FACTS: readonly ProblemFact[] = [
  {
    figure: '+44,3°',
    text: 'воздух в Ташкенте 19 июля 2026, на 0,3° ниже рекорда города.',
    source: 'Узгидромет',
    url: 'https://kun.uz/en/news/2026/08/07/july-heat-shatters-temperature-records-across-uzbekistan',
  },
  {
    figure: '≈20',
    text: 'смертей от жары на 100 тыс. жителей в год, оценка Всемирного банка.',
    source: 'Всемирный банк',
    url: 'https://kun.uz/en/news/2025/07/17/uzbekistan-faces-rising-heatwave-deaths-world-bank-report',
  },
  {
    figure: '11 822 МВт',
    text: 'пик энергосистемы 25 июля 2024; в жару в Ташкенте днём отключали свет.',
    source: 'Минэнерго',
    url: 'https://kun.uz/en/news/2024/07/27/uzbekistans-power-consumption-hits-new-peaks-due-to-extreme-heat',
  },
  {
    figure: '3 м²',
    text: 'зелени на жителя Ташкента, город хочет 6 м².',
    source: 'UzDaily',
    url: 'https://www.uzdaily.uz/en/president-approves-plans-to-triple-green-zones-in-tashkent/',
  },
];
