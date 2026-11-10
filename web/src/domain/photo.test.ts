import { describe, expect, it } from 'vitest';
import { photoThumb } from './photo';

describe('photoThumb', () => {
  it('turns a Commons original into a thumbnail and drops the tracking query', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Tashkentatnight.jpg?utm_source=ru.wikipedia.org&utm_campaign=api';
    expect(photoThumb(url, 500)).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Tashkentatnight.jpg/500px-Tashkentatnight.jpg');
  });

  it('leaves other addresses alone', () => {
    expect(photoThumb('https://example.org/city.jpg')).toBe('https://example.org/city.jpg');
    const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/A.jpg/960px-A.jpg';
    expect(photoThumb(thumb)).toBe(thumb);
  });
});
