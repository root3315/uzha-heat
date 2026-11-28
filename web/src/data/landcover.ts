/**
 * What covers the ground, from ESA WorldCover 2021 (10 m), written per city by `python -m pipeline.landcover --all`:
 * `landcover/<id>.png` (the picture, transparent outside the city) and `landcover/<id>.json` (its corners and each
 * class's share of the city). Optional: without it the map has no land-cover view.
 */
import { DataContractError, isNumber, isObject } from './parse';

export type Corner = [lon: number, lat: number];

export interface CoverClass {
  /** trees, shrubs, grass, cropland, built, bare, water, wetland */
  key: string;
  color: string;
  /** Share of the city's pixels, 0–1. */
  share: number;
}

export interface LandCover {
  url: string;
  /** North-west, north-east, south-east, south-west, as MapLibre's image source wants them. */
  corners: [Corner, Corner, Corner, Corner];
  classes: CoverClass[];
}

function corner(value: unknown, i: number): Corner {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isNumber)) throw new DataContractError(`corners[${i}] must be [lon, lat]`);
  return [value[0], value[1]] as Corner;
}

function coverClass(value: unknown, i: number): CoverClass {
  if (!isObject(value)) throw new DataContractError(`classes[${i}] must be an object`);
  const { key, color, share } = value;
  if (typeof key !== 'string' || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color) || !isNumber(share)) {
    throw new DataContractError(`classes[${i}] must have a key, a #rrggbb color and a share`);
  }
  return { key, color, share };
}

export function parseLandCover(json: unknown, url: string): LandCover {
  if (!isObject(json)) throw new DataContractError('land cover must be an object');
  const { corners, classes } = json;
  if (!Array.isArray(corners) || corners.length !== 4) throw new DataContractError('corners must hold four corners');
  if (!Array.isArray(classes)) throw new DataContractError('classes must be an array');
  return {
    url,
    corners: corners.map(corner) as LandCover['corners'],
    classes: classes.map(coverClass).sort((a, b) => b.share - a.share),
  };
}
