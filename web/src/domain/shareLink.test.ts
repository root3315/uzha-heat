import { describe, expect, it } from 'vitest';
import { readSharedView, sharedViewQuery, withLocale } from './shareLink';

describe('shared view links', () => {
  it('round-trips a place, 3D and the ground', () => {
    const query = sharedViewQuery({ place: [69.240123456, 41.29871], threeD: true, ground: 'satellite', locale: null });
    expect(query).toBe('?place=69.24012,41.29871&3d=1&ground=satellite');
    expect(readSharedView(query)).toEqual({ place: [69.24012, 41.29871], threeD: true, ground: 'satellite', locale: null });
  });

  it('keeps a plain address for a plain view', () => {
    expect(sharedViewQuery({ place: null, threeD: false, ground: 'map', locale: null })).toBe('');
    expect(sharedViewQuery({ place: null, threeD: false, ground: 'map', locale: 'en' })).toBe('');
  });

  it('carries Russian, and English as the default leaves no trace', () => {
    const query = sharedViewQuery({ place: [69.24, 41.3], threeD: false, ground: 'map', locale: 'ru' });
    expect(query).toBe('?place=69.24000,41.30000&lang=ru');
    expect(readSharedView(query).locale).toBe('ru');
    expect(readSharedView('?lang=en').locale).toBe('en');
  });

  it('ignores a malformed or impossible place, and an unknown language', () => {
    expect(readSharedView('?place=abc,1').place).toBeNull();
    expect(readSharedView('?place=69.2').place).toBeNull();
    expect(readSharedView('?place=500,41').place).toBeNull();
    expect(readSharedView('?3d=yes').threeD).toBe(false);
    expect(readSharedView('?ground=moon').ground).toBe('map');
    expect(readSharedView('?lang=uz').locale).toBeNull();
  });

  it('sets the language in any query and keeps the rest', () => {
    expect(withLocale('?place=69.24,41.3&3d=1', 'ru')).toBe('?place=69.24,41.3&3d=1&lang=ru');
    expect(withLocale('?3d=1&lang=ru', 'en')).toBe('?3d=1');
    expect(withLocale('', 'en')).toBe('');
  });
});
