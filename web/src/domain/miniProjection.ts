/**
 * A flat projection for the small city maps: longitude shrunk by cos(latitude) so a city keeps its
 * shape, the whole box centred in the canvas with a margin. Good enough at city scale.
 */
export interface MiniProjection {
  width: number;
  height: number;
  project(lon: number, lat: number): [number, number];
  unproject(x: number, y: number): [number, number];
}

export function miniProjection([w, s, e, n]: [number, number, number, number], width: number, maxHeight: number, margin = 16): MiniProjection {
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const spanX = Math.max(1e-9, (e - w) * k);
  const spanY = Math.max(1e-9, n - s);
  const scale = Math.min((width - 2 * margin) / spanX, (maxHeight - 2 * margin) / spanY);
  const height = Math.round(Math.min(maxHeight, spanY * scale + 2 * margin));
  const ox = (width - spanX * scale) / 2;
  const oy = (height - spanY * scale) / 2;
  return {
    width,
    height,
    project: (lon, lat) => [ox + (lon - w) * k * scale, oy + (n - lat) * scale],
    unproject: (x, y) => [w + (x - ox) / (k * scale), n - (y - oy) / scale],
  };
}
