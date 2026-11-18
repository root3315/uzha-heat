import { describe, expect, it } from 'vitest';
import { readSharedView, sharedViewQuery } from './shareLink';

describe('shared view links', () => {
  it('round-trips a place and 3D', () => {
    const query = sharedViewQuery({ place: [69.240123456, 41.29871], threeD: true });
    expect(query).toBe('?place=69.24012,41.29871&3d=1');
    expect(readSharedView(query)).toEqual({ place: [69.24012, 41.29871], threeD: true });
  });

  it('keeps a plain address for a plain view', () => {
    expect(sharedViewQuery({ place: null, threeD: false })).toBe('');
  });

  it('ignores a malformed or impossible place', () => {
    expect(readSharedView('?place=abc,1').place).toBeNull();
    expect(readSharedView('?place=69.2').place).toBeNull();
    expect(readSharedView('?place=500,41').place).toBeNull();
    expect(readSharedView('?3d=yes').threeD).toBe(false);
  });
});
