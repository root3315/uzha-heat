import { describe, expect, it } from 'vitest';
import { ANSWER_TEXTS } from './answers.texts';
import { causeWords } from './causes';
import { formats } from './format';
import { hasIcon } from '../ui/icons';
import { patternTile } from '../ui/patterns';

/** Formatting uses non-breaking spaces; compare with plain ones for readability. */
const plain = (text: string) => text.replace(/[  ]/g, ' ');
const { formatFactorValue } = formats('ru');

describe('building height and volume', () => {
  it('formats metres of height without rounding them away, and volume to hundreds', () => {
    expect(plain(formatFactorValue({ unit: 'м' }, 7.4))).toBe('7 м');
    expect(plain(formatFactorValue({ unit: 'м' }, 436))).toBe('440 м');
    expect(plain(formatFactorValue({ unit: 'м³/га' }, 12_345))).toBe('12 300 м³/га');
  });

  it('has words, an icon and a hatch of their own', () => {
    for (const key of ['height', 'volume']) {
      expect(causeWords({ key, label: key, unit: '' }, 'ru').heats).not.toBe(key);
      expect(hasIcon(key)).toBe(true);
      expect(patternTile(key, 'heats').marks.length).toBeGreaterThan(0);
    }
    expect(plain(causeWords({ key: 'height', label: '', unit: 'м' }, 'ru').measure(17.6))).toBe('дома в среднем 18 м высотой');
    expect(plain(causeWords({ key: 'volume', label: '', unit: 'м³/га' }, 'ru').measure(30_049))).toBe('30 000 м³ зданий на га');
  });
});

describe('a factor that is not a lever', () => {
  it('agrees the English verb with a plural subject', () => {
    const sentence = (key: string) => ANSWER_TEXTS.en.advice.notLever(causeWords({ key, label: '', unit: '' }, 'en'), '+0.9°').join('');
    expect(sentence('height')).toMatch(/^Tall buildings add \+0\.9°/);
    expect(sentence('elevation')).toMatch(/^Terrain adds \+0\.9°/);
  });
});
