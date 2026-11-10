import type { FacilityType } from '../data/contract';
import { FACILITY_SHAPES } from '../ui/icons';
import type { MapTokens } from './tokens';

/** Marker size on the map, css px: a paper disc with the icon drawn in ink, as on a printed plan. */
const SIZE = 22;
const GLYPH = 15;

export const facilityImageId = (type: FacilityType): string => `facility-${type}`;

/** The facility icon from icons.tsx, drawn on a canvas for MapLibre. */
export function facilityImage(type: FacilityType, tokens: MapTokens, pixelRatio: number): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * pixelRatio;
  canvas.height = SIZE * pixelRatio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
  ctx.fillStyle = tokens.ground;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = tokens.ink;
  ctx.stroke();

  const offset = (SIZE - GLYPH) / 2;
  ctx.translate(offset, offset);
  ctx.scale(GLYPH / 24, GLYPH / 24);
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = tokens.ink;
  for (const shape of FACILITY_SHAPES[type]) {
    if ('path' in shape) {
      ctx.stroke(new Path2D(shape.path));
      continue;
    }
    const [cx, cy, r] = shape.circle;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (shape.dot) ctx.fill();
    else ctx.stroke();
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
