import type { LandCover } from '../data/landcover';
import type { Ground } from '../map/style';
import { useFormats, useLocale } from './locale';
import { GROUND_TEXTS } from './ui.texts';

/** A satellite with its two panels, and the line it sends down. */
const SATELLITE_ICON = 'M9 12l3-3 3 3-3 3zM10.5 10.5 7.5 7.5M3 7.5 7.5 3l3 3L6 10.5zM13.5 13.5l3 3M13.5 18 18 13.5l3 3-4.5 4.5zM4 15.5a4.5 4.5 0 0 0 4.5 4.5';
/** Four patches of ground, one filled: the land cover. */
const COVER_ICON = 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z';

function Icon({ path, filled }: { path: string; filled?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      {filled && <path d={filled} fill="currentColor" stroke="none" />}
      <path d={path} />
    </svg>
  );
}

interface GroundSwitchProps {
  ground: Ground;
  onChange(ground: Ground): void;
  /** No land cover file for the city: only the photo is offered. */
  hasCover: boolean;
  /** On a phone: two pills in the map's toolbar; elsewhere two square buttons under the 3D one. */
  compact: boolean;
}

/** The satellite photo and the land cover under the temperature; pressing the one that is on brings the map back. */
export function GroundSwitch({ ground, onChange, hasCover, compact }: GroundSwitchProps) {
  const t = GROUND_TEXTS[useLocale()];
  const options: { ground: Ground; label: string; short: string; icon: JSX.Element }[] = [
    { ground: 'satellite', label: t.satellite, short: t.satelliteShort, icon: <Icon path={SATELLITE_ICON} /> },
    ...(hasCover ? [{ ground: 'cover' as const, label: t.cover, short: t.coverShort, icon: <Icon path={COVER_ICON} filled="M13 13h7v7h-7z" /> }] : []),
  ];
  return (
    <>
      {options.map((option, i) => {
        const on = ground === option.ground;
        return (
          <button
            key={option.ground}
            type="button"
            className={compact ? 'pill pill--small' : `map-3d map-ground map-ground--${i}`}
            aria-pressed={on}
            aria-label={compact ? undefined : option.label}
            title={compact ? undefined : on ? t.backToMap : option.label}
            onClick={() => onChange(on ? 'map' : option.ground)}
          >
            {compact ? option.short : option.icon}
          </button>
        );
      })}
    </>
  );
}

/** What each colour of the land cover is, and how much of the city it covers. */
export function CoverKey({ cover }: { cover: LandCover }) {
  const locale = useLocale();
  const t = GROUND_TEXTS[locale];
  const { formatPercent } = useFormats();
  const shown = cover.classes.filter((c) => c.share >= 0.005);
  return (
    <div className="cover-key">
      <ul className="cause-key" aria-label={t.coverKey}>
        {shown.map((c) => (
          <li key={c.key}>
            <span className="cover-key__swatch" style={{ background: c.color }} aria-hidden="true" />
            {t.classes[c.key] ?? c.key} <span className="num">{formatPercent(c.share)}</span>
          </li>
        ))}
      </ul>
      <p className="people-key__note">{t.coverNote}</p>
    </div>
  );
}
