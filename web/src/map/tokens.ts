/** Map colours come from the same CSS custom properties as the page, so there is one palette. */
export interface MapTokens {
  ground: string;
  ink: string;
  pencil: string;
  grid: string;
  water: string;
  hatchHeats: string;
  classes: string[];
  /** Fill opacity per class. */
  classOpacity: number[];
}

export function readTokens(element: Element = document.documentElement): MapTokens {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    ground: token('--ground'),
    ink: token('--ink'),
    pencil: token('--pencil'),
    grid: token('--grid'),
    water: token('--water'),
    hatchHeats: token('--hatch-heats'),
    classes: [0, 1, 2, 3, 4, 5, 6].map((k) => token(`--t${k}`)),
    classOpacity: [0, 1, 2, 3, 4, 5, 6].map((k) => Number(token(`--o${k}`)) || 1),
  };
}

/** "#17212b" at some opacity, as MapLibre wants it. */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
