import type { Map as MapLibreMap } from 'maplibre-gl';
import { formatNumber } from '../domain/format';
import type { LabelAnchor } from '../domain/isotherms';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Labels closer than this on screen, px, are thinned out; majors are placed first. */
const MIN_GAP_PX = 84;
const EDGE_PX = 16;

export interface PlacedLabel {
  x: number;
  y: number;
  angle: number;
  text: string;
  major: boolean;
}

/** Screen positions for the anchors in view: upright, along the line, never crowded. */
export function placeLabels(map: MapLibreMap, anchors: readonly LabelAnchor[]): PlacedLabel[] {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const placed: PlacedLabel[] = [];
  for (const anchor of anchors) {
    const at = map.project(anchor.at as [number, number]);
    if (at.x < EDGE_PX || at.y < EDGE_PX || at.x > w - EDGE_PX || at.y > h - EDGE_PX) continue;
    if (placed.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < MIN_GAP_PX)) continue;
    const toward = map.project(anchor.toward as [number, number]);
    let angle = (Math.atan2(toward.y - at.y, toward.x - at.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    placed.push({ x: at.x, y: at.y, angle, text: `${formatNumber(anchor.t, 0)}°`, major: anchor.major });
  }
  return placed;
}

/**
 * Isotherm labels set in the page's own serif. MapLibre can only draw its glyph fonts,
 * so the labels live in an SVG over the canvas and follow every frame.
 */
export class IsothermLabelLayer {
  private readonly anchors: LabelAnchor[];

  constructor(
    private readonly map: MapLibreMap,
    private readonly svg: SVGSVGElement,
    anchors: readonly LabelAnchor[],
  ) {
    this.anchors = [...anchors].sort((a, b) => Number(b.major) - Number(a.major));
  }

  update(): void {
    const labels = placeLabels(this.map, this.anchors);
    const nodes = this.svg.children;
    labels.forEach((label, i) => {
      let node = nodes[i] as SVGTextElement | undefined;
      if (!node) {
        node = document.createElementNS(SVG_NS, 'text');
        this.svg.appendChild(node);
      }
      node.textContent = label.text;
      node.setAttribute('transform', `translate(${label.x.toFixed(1)} ${label.y.toFixed(1)}) rotate(${label.angle.toFixed(1)})`);
      node.setAttribute('class', label.major ? 'isotherm-label is-major' : 'isotherm-label');
    });
    while (this.svg.children.length > labels.length) this.svg.lastChild?.remove();
  }
}
