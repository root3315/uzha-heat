import { describe, expect, it } from 'vitest';
import { distanceM, distanceToLineM, placeName, streetGenitive } from './placeName';

const HERE: [number, number] = [69.25, 41.3];

describe('distances', () => {
  it('measures about 111 km per degree of latitude', () => {
    expect(distanceM([69, 41], [69, 42])).toBeCloseTo(111_320, -2);
  });

  it('measures to the nearest point of a line, not its vertices', () => {
    const line: [number, number][] = [
      [69.24, 41.301],
      [69.26, 41.301],
    ];
    expect(distanceToLineM(HERE, line)).toBeCloseTo(111.3, 0);
  });
});

describe('placeName', () => {
  const places = [
    { name: 'Чиланзар', point: [69.255, 41.302] as [number, number] },
    { name: 'Юнусабад', point: [69.29, 41.36] as [number, number] },
  ];
  const streets = [{ name: 'улица Бабура', line: [[69.24, 41.3005], [69.26, 41.3005]] as [number, number][] }];

  it('prefers the nearest named place within reach', () => {
    expect(placeName(HERE, places, streets, 'Чиланзарский район', 'ru')).toEqual({ name: 'Чиланзар', precision: 3 });
  });

  it('falls back to the nearest street, in the genitive', () => {
    expect(placeName(HERE, places, streets, null, 'ru', { placeRadiusM: 100 })).toEqual({ name: 'Участок у улицы Бабура', precision: 2 });
  });

  it('falls back to the district from the data when the basemap has nothing near', () => {
    expect(placeName(HERE, [], [], 'Чиланзарский район', 'ru')).toEqual({ name: 'Чиланзарский район', precision: 1 });
  });

  it('keeps the street name as the map gives it in English, and puts the district into English', () => {
    const latin = [{ name: "Bobur ko'chasi", line: streets[0]!.line }];
    expect(placeName(HERE, places, latin, null, 'en', { placeRadiusM: 100 })).toEqual({ name: "Near Bobur ko'chasi", precision: 2 });
    expect(placeName(HERE, [], [], 'Чиланзарский район', 'en')).toEqual({ name: 'Chilonzor district', precision: 1 });
  });

  it('returns null when nothing named is near', () => {
    expect(placeName(HERE, [], [], null, 'ru')).toBeNull();
  });
});

describe('streetGenitive', () => {
  it.each([
    ['улица Бабура', 'улицы Бабура'],
    ['проспект Амира Темура', 'проспекта Амира Темура'],
    ['Ханабадтепа проспект', 'проспекта Ханабадтепа'],
    ['Ташкентская городская объездная дорога', 'Ташкентской городской объездной дороги'],
    ['Чиланзарская улица', 'Чиланзарской улицы'],
    ['Юнусабадский проезд', 'Юнусабадского проезда'],
    ['Малый кольцевой проезд', 'Малого кольцевого проезда'],
    ['Верхняя набережная', 'Верхней набережной'],
    ['Кичик халка йули', 'Кичик халка йули'],
    ["Bobur ko'chasi", "Bobur ko'chasi"],
  ])('%s → %s', (name, expected) => expect(streetGenitive(name)).toBe(expected));
});
