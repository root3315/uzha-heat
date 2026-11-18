import { describe, expect, it } from 'vitest';
import { cityName, districtName, featureLabel, featureUnit, periodText, surfaceLabel } from './dataTexts';
import { loadingLine } from './loading';

describe('data texts in English', () => {
  it('puts the Russian labels of the fixed vocabulary into English, and keeps Russian as it is', () => {
    expect(featureLabel({ key: 'tree', label: 'Древесный покров' }, 'en')).toBe('Tree cover');
    expect(featureLabel({ key: 'tree', label: 'Древесный покров' }, 'ru')).toBe('Древесный покров');
    expect(featureUnit({ unit: 'м³/га' }, 'en')).toBe('m³/ha');
    expect(surfaceLabel({ key: 'dry_soil', label: 'Сухой грунт' }, 'en')).toBe('Dry soil');
  });

  it('shows a key outside the vocabulary as the data has it', () => {
    expect(featureLabel({ key: 'smog', label: 'Смог' }, 'en')).toBe('Смог');
    expect(districtName('Новый район', 'en')).toBe('Новый район');
  });

  it('names cities and districts the English way', () => {
    expect(cityName({ name: 'Ташкент', nameEn: 'Tashkent' }, 'en')).toBe('Tashkent');
    expect(cityName({ name: 'Ташкент', nameEn: 'Tashkent' }, 'ru')).toBe('Ташкент');
    expect(districtName('Юнусабадский район', 'en')).toBe('Yunusobod district');
  });

  it('writes the period in English', () => {
    expect(periodText('июнь–август 2023–2025', 'en')).toBe('June–August 2023–2025');
    expect(periodText('июнь–август 2023–2025', 'ru')).toBe('июнь–август 2023–2025');
  });

  it('says the loading line in English', () => {
    expect(loadingLine({ download: { received: 1_234_567, total: 3_506_203 }, building: false }, 'en')).toBe('data 1.2 of 3.5 MB');
    expect(loadingLine({ download: null, building: false }, 'en')).toBe('loading data');
  });
});
