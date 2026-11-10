import { describe, expect, it } from 'vitest';
import { loadingLine, loadingShare } from './loading';

describe('loadingLine', () => {
  it('says what is downloaded of how much', () => {
    expect(loadingLine({ download: { received: 1_234_567, total: 3_506_203 }, building: false })).toBe('данные 1,2 из 3,5 МБ');
    expect(loadingShare({ download: { received: 1_000_000, total: 4_000_000 }, building: false })).toBe(0.25);
  });

  it('gives only the bytes received when the total is unknown', () => {
    expect(loadingLine({ download: { received: 800_000, total: null }, building: false })).toBe('данные 0,8 МБ');
    expect(loadingShare({ download: { received: 800_000, total: null }, building: false })).toBeNull();
  });

  it('switches to the build once the file is in', () => {
    expect(loadingLine({ download: { received: 10, total: 10 }, building: true })).toBe('строю изотермы');
    expect(loadingShare({ download: { received: 10, total: 10 }, building: true })).toBeNull();
    expect(loadingLine({ download: null, building: false })).toBe('загружаю данные');
  });
});
