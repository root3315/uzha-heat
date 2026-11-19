import { useMemo, useState } from 'react';
import type { CityDetail } from '../data/contract';
import { loadPhysics, loadSeb } from '../data/load';
import { baseline, mayHaveSurfaces, surfaceCell, surfaceLevers, surfaceWhatIf, type SurfaceLever, type SurfaceSettings } from '../domain/surfaces';
import { useAsync } from './hooks';
import { useFormats, useLocale } from './locale';
import { SURFACES_TEXTS, WHAT_IF_TEXTS } from './ui.texts';
import { Slider } from './WhatIf';

/** Changes smaller than this read as no change, as in "What if". */
const NEGLIGIBLE_DEG = 0.05;

function SurfaceSlider({ lever, value, onChange }: { lever: SurfaceLever; value: number; onChange: (value: number) => void }) {
  const t = SURFACES_TEXTS[useLocale()];
  const { formatNumber, formatPercent } = useFormats();
  const say = lever.key === 'greenRoofs' ? formatPercent : (v: number) => formatNumber(v, 2);
  const words = t.levers[lever.key];
  return (
    <Slider
      id={`surfaces-${lever.key}`}
      label={words.label}
      from={lever.from}
      to={lever.to}
      step={lever.step}
      value={value}
      say={say}
      spoken={words.spoken}
      limit={t.limits[lever.key](say(lever.to))}
      onChange={onChange}
    />
  );
}

function SurfacesBody({ detail, cell, explained }: { detail: CityDetail; cell: number; explained: number }) {
  const seb = useAsync(() => loadSeb(detail.city.id), [detail.city.id]);
  const place = useMemo(() => (seb.status === 'ready' ? surfaceCell(seb.data, cell) : null), [seb, cell]);
  const levers = useMemo(() => (place ? surfaceLevers(place.inputs) : []), [place]);
  const base = useMemo(() => (place ? baseline(place) : null), [place]);
  const [settings, setSettings] = useState<SurfaceSettings>({});
  const locale = useLocale();
  const t = SURFACES_TEXTS[locale];
  const w = WHAT_IF_TEXTS[locale];
  const { formatDeg, formatDegSigned, formatPercent } = useFormats();

  if (seb.status === 'loading') return <p className="whatif__status">{t.loading}</p>;
  if (seb.status === 'error' || !place || !base) return <p className="whatif__status">{t.failed}</p>;
  if (!levers.length) return <p className="whatif__status">{t.nothing}</p>;

  const result = surfaceWhatIf(place, settings, base);
  const changed = Object.keys(settings).length > 0;
  const shown = Math.abs(result.delta) < NEGLIGIBLE_DEG ? 0 : result.delta;
  const tone = shown < 0 ? 'cool' : shown > 0 ? 'hot' : 'none';
  const lst = detail.cells.lst[cell] ?? Number.NaN;

  return (
    <>
      {levers.map((lever) => (
        <SurfaceSlider
          key={lever.key}
          lever={lever}
          value={settings[lever.key] ?? lever.from}
          onChange={(value) => setSettings((current) => ({ ...current, [lever.key]: value }))}
        />
      ))}
      {changed && !result.converged ? (
        <p className="whatif__status">{t.unsettled}</p>
      ) : (
        <div className="whatif__result">
          {/* Before any move there is no change to state: a big "0.0°" would read as a temperature, so only the hint shows. */}
          <output className={changed ? `whatif__delta num${tone === 'none' ? '' : ` num--${tone}`}` : 'visually-hidden'} aria-live="polite">
            {changed ? formatDegSigned(shown) : w.noChange}
            {changed && <span className="visually-hidden">{w.toSurface}</span>}
          </output>
          <p className="whatif__caption">
            {changed ? w.result(formatDeg(lst + shown), formatDeg(lst)) : w.hint}
            {changed && result.treated !== null && `; ${t.treated(formatDegSigned(result.treated), formatPercent(result.treatedShare))}`}
          </p>
        </div>
      )}
      {changed && (
        <button type="button" className="whatif__reset" onClick={() => setSettings({})}>
          {w.reset}
        </button>
      )}
      <p className="whatif__caveat">
        {t.skill(formatPercent(explained))}
        {t.assumptions}
      </p>
    </>
  );
}

/**
 * "Surfaces (physics)" for one picked cell: roof and road albedo and green roofs, and how the physics model (the
 * energy balance of the place, solved in the browser) moves its surface temperature. Shown only where the cell may
 * have roofs or roads and the city has a fitted physics model; its inputs are fetched the first time it is opened.
 */
export function SurfacesBlock({ detail, cell }: { detail: CityDetail; cell: number }) {
  const [open, setOpen] = useState(false);
  const physics = useAsync(loadPhysics, []);
  const t = SURFACES_TEXTS[useLocale()];
  const skill = physics.status === 'ready' ? physics.data[detail.city.id]?.skill.physics : undefined;
  if (!skill || !mayHaveSurfaces(detail.cells.values, cell)) return null;
  return (
    <details className="whatif" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="whatif__summary">
        <span className="whatif__title">{t.title}</span>
        <span className="whatif__hint">
          {t.recalc}
          <svg className="whatif__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" />
          </svg>
        </span>
      </summary>
      {open && (
        <div className="whatif__body">
          <SurfacesBody key={cell} detail={detail} cell={cell} explained={Math.min(1, Math.max(0, skill.r2))} />
        </div>
      )}
    </details>
  );
}
