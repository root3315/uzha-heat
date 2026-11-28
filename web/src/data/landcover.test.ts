import { describe, expect, it } from 'vitest';
import { parseGroundImage, parseLandCover } from './landcover';

const FILE = {
  source: 'ESA WorldCover 2021 (10 m)',
  corners: [
    [69.1, 41.4],
    [69.5, 41.4],
    [69.5, 41.1],
    [69.1, 41.1],
  ],
  classes: [
    { key: 'trees', color: '#3f7d4e', share: 0.07 },
    { key: 'built', color: '#8a8f99', share: 0.55 },
  ],
};

describe('parseLandCover', () => {
  it('keeps the corners in order and puts the largest class first', () => {
    const cover = parseLandCover(FILE, '/data/landcover/tashkent.png');
    expect(cover.url).toBe('/data/landcover/tashkent.png');
    expect(cover.corners[0]).toEqual([69.1, 41.4]);
    expect(cover.classes.map((c) => c.key)).toEqual(['built', 'trees']);
  });

  it('refuses a file without four corners or with a broken colour', () => {
    expect(() => parseLandCover({ ...FILE, corners: FILE.corners.slice(1) }, '')).toThrow(/four corners/);
    expect(() => parseLandCover({ ...FILE, classes: [{ key: 'trees', color: 'green', share: 1 }] }, '')).toThrow(/color/);
  });
});

describe('parseGroundImage', () => {
  it('reads a photo with corners only', () => {
    const photo = parseGroundImage({ corners: FILE.corners }, '/data/photo/tashkent.webp');
    expect(photo).toEqual({ url: '/data/photo/tashkent.webp', corners: FILE.corners });
  });
});
