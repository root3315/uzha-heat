import type { NightGrid } from '../data/night';
import { periodText } from '../domain/dataTexts';
import { legendClasses, type MapLayer, type MapOverlay } from '../domain/layers';
import { LAYER_TEXTS } from './layers.texts';
import { useFormats, useLocale } from './locale';

interface LayerSwitchProps {
  layers: readonly MapLayer[];
  layer: MapLayer;
  onChange(layer: MapLayer): void;
  /** On a phone a select in the chip row; elsewhere a row of pills on the map. */
  compact: boolean;
}

/** Which quantity the map colours: the surface temperature, where the sunlight goes, or the night. */
export function LayerSwitch({ layers, layer, onChange, compact }: LayerSwitchProps) {
  const t = LAYER_TEXTS[useLocale()];
  if (layers.length < 2) return null;
  if (compact) {
    return (
      <label className="city-switcher">
        <span className="visually-hidden">{t.switchLabel}</span>
        <select value={layer} onChange={(event) => onChange(event.target.value as MapLayer)}>
          {layers.map((key) => (
            <option key={key} value={key}>
              {t.short[key]}
            </option>
          ))}
        </select>
        <svg className="city-switcher__chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </label>
    );
  }
  return (
    <div className="map-layers" role="group" aria-label={t.switchLabel}>
      {layers.map((key) => (
        <button key={key} type="button" className="pill pill--small" aria-pressed={layer === key} title={t.name[key]} onClick={() => onChange(key)}>
          {t.short[key]}
        </button>
      ))}
    </div>
  );
}

interface LayerKeyProps {
  overlay: MapOverlay;
  /** Local hour of the Landsat overpass the energy balance is for. */
  hour: number;
  night: NightGrid | null;
}

/** The legend of an extra layer: its name and unit, its steps in their colours, and one line on what it means. */
export function LayerKey({ overlay, hour, night }: LayerKeyProps) {
  const locale = useLocale();
  const t = LAYER_TEXTS[locale];
  const { formatNumber, formatDeg } = useFormats();
  const isNight = overlay.kind === 'pixels';
  const value = (v: number) => (isNight ? formatDeg(v, 0) : formatNumber(v, 0));
  const classes = legendClasses(overlay.layer, overlay.levels);
  const label = (from: number | null, to: number | null) => {
    if (from === null && to !== null) return t.below(value(to));
    if (to === null && from !== null) return t.above(value(from));
    return `${value(from ?? 0)}–${value(to ?? 0)}`;
  };
  const note = overlay.kind === 'pixels' ? t.nightExplain(periodText(night?.period ?? '', locale)) : t.explain[overlay.layer](hour);
  return (
    <div className="layer-key">
      <p className="layer-key__title">
        {t.name[overlay.layer]}
        {!isNight && <span className="layer-key__unit">{t.perSquareMetre}</span>}
      </p>
      <ol className="layer-key__steps">
        {classes.map(({ colour, from, to }) => (
          <li key={colour} title={label(from, to)}>
            <span className="layer-key__swatch" style={{ background: `var(--t${colour})`, opacity: `var(--o${colour})` }} />
            <span className="layer-key__tick num">{from === null ? '' : value(from)}</span>
          </li>
        ))}
      </ol>
      <p className="layer-key__note">{note}</p>
    </div>
  );
}
