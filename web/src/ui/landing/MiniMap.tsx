import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Position } from 'geojson';
import type { CityModel } from '../../domain/cityModel';
import { geometryBounds } from '../../domain/stats';
import { miniProjection, type MiniProjection } from '../../domain/miniProjection';
import { useWidth } from '../hooks';
import { useReadout } from '../readout';

interface MiniMapProps {
  model: CityModel;
  height: number;
  label: string;
}

function tracePolygons(ctx: CanvasRenderingContext2D, projection: MiniProjection, polygons: Position[][][]): void {
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach(([lon = 0, lat = 0], i) => {
        const [x, y] = projection.project(lon, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  }
}

/**
 * The city's isotherms drawn flat on a canvas: no tiles, no WebGL, so three of them cost almost nothing.
 * Under the pointer it reads out the temperature and the main cause, like the big map.
 */
export function MiniMap({ model, height, label }: MiniMapProps) {
  const [frameRef, width] = useWidth<HTMLDivElement>(640);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const { describe } = useReadout(model);
  const area = model.outline ?? model.isotherms.coverage;
  const projection = miniProjection(geometryBounds(area), width, Math.min(height, Math.round(width * 0.85)));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(projection.width * ratio);
    canvas.height = Math.round(projection.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(canvas);
    const token = (name: string) => style.getPropertyValue(name).trim();

    ctx.clearRect(0, 0, projection.width, projection.height);
    ctx.save();
    if (model.outline) {
      ctx.beginPath();
      tracePolygons(ctx, projection, model.outline.type === 'Polygon' ? [model.outline.coordinates] : model.outline.coordinates);
      ctx.fillStyle = token('--shade');
      ctx.fill();
      ctx.clip();
    }
    for (const band of model.isotherms.bands.features) {
      const k = band.properties.k;
      ctx.beginPath();
      tracePolygons(ctx, projection, band.geometry.coordinates);
      ctx.globalAlpha = Number(token(`--o${k}`)) || 1;
      ctx.fillStyle = token(`--t${k}`);
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = token('--ink');
    ctx.globalAlpha = 0.3;
    for (const line of model.isotherms.lines.features) {
      ctx.beginPath();
      line.geometry.coordinates.forEach(([lon = 0, lat = 0], i) => {
        const [x, y] = projection.project(lon, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.restore();
    if (model.outline) {
      ctx.beginPath();
      tracePolygons(ctx, projection, model.outline.type === 'Polygon' ? [model.outline.coordinates] : model.outline.coordinates);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = token('--ink');
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [model, projection.width, projection.height]);

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const text = describe(projection.unproject(x, y));
    setTip(text ? { x, y, text } : null);
  };

  return (
    <div ref={frameRef} className="mini">
      <canvas
        ref={canvasRef}
        className="mini__canvas"
        style={{ width: projection.width, height: projection.height }}
        role="img"
        aria-label={label}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setTip(null)}
      />
      {tip && (
        <p className="map__tip is-on" aria-hidden="true" style={{ transform: `translate(${Math.round(tip.x + 14)}px, ${Math.round(tip.y - 14)}px) translate(${tip.x > width - 200 ? 'calc(-100% - 28px)' : '0'}, -100%)` }}>
          {tip.text}
        </p>
      )}
    </div>
  );
}
