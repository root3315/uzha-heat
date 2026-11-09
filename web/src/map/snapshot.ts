import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Transect } from '../domain/transect';
import type { PlacedLabel } from './isothermLabels';
import type { MapTokens } from './tokens';

/** The drawing buffer is only valid inside the frame that drew it, so copy it from the render event. */
function captureCanvas(map: MapLibreMap): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    map.once('render', () => {
      const source = map.getCanvas();
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      copy.getContext('2d')?.drawImage(source, 0, 0);
      resolve(copy);
    });
    map.triggerRepaint();
  });
}

/** The map as the report shows it: canvas, isotherm labels and the А and Б ends, in one image. */
export async function snapshotMap(map: MapLibreMap, labels: PlacedLabel[], transect: Transect, tokens: MapTokens): Promise<string> {
  const canvas = await captureCanvas(map);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/png');
  const ratio = canvas.width / map.getContainer().clientWidth;
  ctx.scale(ratio, ratio);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  for (const label of labels) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate((label.angle * Math.PI) / 180);
    ctx.font = `${label.major ? 600 : 400} 11px Literata`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = tokens.ground;
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = tokens.ink;
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }

  transect.forEach((end, i) => {
    const { x, y } = map.project(end);
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = tokens.ground;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = tokens.ink;
    ctx.stroke();
    ctx.fillStyle = tokens.ink;
    ctx.font = '600 12px Commissioner';
    ctx.fillText(i === 0 ? 'А' : 'Б', x, y + 0.5);
  });
  return canvas.toDataURL('image/png');
}
