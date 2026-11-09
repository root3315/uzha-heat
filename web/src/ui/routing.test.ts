import { describe, expect, it } from 'vitest';
import { methodHref, parseRoute, toolHref } from './routing';

describe('parseRoute', () => {
  it('opens the story at the root', () => {
    expect(parseRoute('/')).toEqual({ view: 'story', cityId: null });
  });

  it('reads the tool and the method with a city', () => {
    expect(parseRoute('/map/bukhara')).toEqual({ view: 'tool', cityId: 'bukhara' });
    expect(parseRoute('/map')).toEqual({ view: 'tool', cityId: null });
    expect(parseRoute('/method/samarkand')).toEqual({ view: 'method', cityId: 'samarkand' });
  });

  it('honours a base path', () => {
    expect(parseRoute('/uzha/map/tashkent', '', '/uzha/')).toEqual({ view: 'tool', cityId: 'tashkent' });
  });

  it('keeps old hash links working', () => {
    expect(parseRoute('/', '#/city/tashkent')).toEqual({ view: 'tool', cityId: 'tashkent' });
    expect(parseRoute('/', '#/city/tashkent/method')).toEqual({ view: 'method', cityId: 'tashkent' });
  });

  it('falls back to the story on anything else', () => {
    expect(parseRoute('/whatever')).toEqual({ view: 'story', cityId: null });
  });
});

describe('hrefs', () => {
  it('round-trips through parseRoute', () => {
    expect(parseRoute(toolHref('samarkand', '/'))).toEqual({ view: 'tool', cityId: 'samarkand' });
    expect(parseRoute(methodHref('bukhara', '/'))).toEqual({ view: 'method', cityId: 'bukhara' });
  });
});
