import { useEffect, useMemo, useState } from 'react';
import type { CityDetail, FeatureMeta, TreeModel } from '../data/contract';
import { loadTreeModel } from '../data/load';
import { featureLabel } from '../domain/dataTexts';
import { cityRanges, cutText, leversFor, whatIf, type FactorValues, type LeverRange } from '../domain/whatIf';
import { useFormats, useLocale } from './locale';
import { WHAT_IF_TEXTS, type LeverWords } from './ui.texts';

/** Changes smaller than this read as no change. */
const NEGLIGIBLE_DEG = 0.05;

export type ModelState = { status: 'loading' } | { status: 'ready'; model: TreeModel } | { status: 'failed' };

/** The city's model for "what if", fetched once per city. */
export function useTreeModel(cityId: string): ModelState {
  const [state, setState] = useState<ModelState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadTreeModel(cityId).then(
      (model) => alive && setState({ status: 'ready', model }),
      () => alive && setState({ status: 'failed' }),
    );
    return () => {
      alive = false;
    };
  }, [cityId]);
  return state;
}

const column = (columns: Record<string, readonly number[]>, cell: number): FactorValues =>
  Object.fromEntries(Object.entries(columns).map(([key, values]) => [key, values[cell] ?? Number.NaN]));

export interface SliderProps {
  /** The input's id; the limit line gets `${id}-limit`. */
  id: string;
  label: string;
  /** The value as the cell is now, and the furthest the slider goes (on either side of it). */
  from: number;
  to: number;
  /** The step; rounded so that the steps divide the span exactly. */
  step: number;
  value: number;
  say: (value: number) => string;
  /** What a screen reader hears for the value, unit in words. */
  spoken: (said: string) => string;
  /** The line under the far end: how far the slider goes and why. */
  limit: string;
  onChange: (value: number) => void;
}

/** A slider from "now" to a limit: a rail, the stretch moved from "now", a tick at "now". */
export function Slider({ id, label, from, to, step, value, say, spoken, limit, onChange }: SliderProps) {
  const t = WHAT_IF_TEXTS[useLocale()];
  const up = to >= from;
  // The input measures how far from "now": 0 is the cell as it is, always on the step grid, so the slider can
  // always come back to it; the grid divides the span exactly, so the far end is reachable too.
  const span = Math.abs(to - from);
  const steps = Math.max(1, Math.round(span / step));
  const amount = Math.min(span, Math.abs(value - from));
  const at = span > 0 ? amount / span : 0;
  return (
    <div className="whatif__lever">
      <p className="whatif__head">
        <label htmlFor={id}>{label}</label>
        <span className="whatif__value num">{say(value)}</span>
      </p>
      <div className="whatif__slider">
        <div className="whatif__rail" aria-hidden="true">
          <span className="whatif__fill" style={{ left: '0%', width: `${at * 100}%` }} />
          <span className="whatif__now" style={{ left: '0%' }} />
        </div>
        <input
          id={id}
          className="whatif__range"
          type="range"
          min={0}
          max={steps}
          step={1}
          value={span > 0 ? Math.round((amount / span) * steps) : 0}
          aria-valuetext={t.spokenNow(spoken(say(value)), say(from))}
          aria-describedby={`${id}-limit`}
          onChange={(event) => {
            // Whole steps, so the far end is reached exactly: a fractional step makes the browser stop one short of it.
            const moved = (Number(event.currentTarget.value) / steps) * span;
            onChange(up ? from + moved : from - moved);
          }}
        />
      </div>
      <p className="whatif__ends">
        {/* The value now is already in aria-valuetext; the limit is the slider's description. */}
        <span aria-hidden="true">{t.now(say(from))}</span>
        <span id={`${id}-limit`}>{limit}</span>
      </p>
    </div>
  );
}

interface LeverSliderProps {
  range: LeverRange;
  feature: FeatureMeta;
  value: number;
  onChange: (value: number) => void;
}

function LeverSlider({ range, feature, value, onChange }: LeverSliderProps) {
  const { lever, from, to } = range;
  const locale = useLocale();
  const t = WHAT_IF_TEXTS[locale];
  const { formatFactorValue } = useFormats();
  const label = featureLabel(feature, locale);
  const text: LeverWords = (t.levers as Partial<Record<string, LeverWords>>)[lever.key] ?? { label, spoken: (v) => t.spokenOther(label, v) };
  const say = (v: number) => formatFactorValue(feature, v);
  const cut = range.bound === 'cut' ? cutText(lever, locale) : undefined;
  const reason = cut ? `${cut}${text.noun ? ` ${text.noun}` : ''}` : t.cityTail(lever.direction === 'up');
  return (
    <Slider
      id={`whatif-${lever.key}`}
      label={text.label}
      from={from}
      to={to}
      step={lever.step}
      value={value}
      say={say}
      spoken={text.spoken}
      limit={t.limit(say(to), reason)}
      onChange={onChange}
    />
  );
}

function WhatIfBody({ detail, cell }: { detail: CityDetail; cell: number }) {
  const state = useTreeModel(detail.city.id);
  const ranges = cityRanges(detail.cells.values);
  const values = useMemo(() => column(detail.cells.values, cell), [detail, cell]);
  const contributions = useMemo(() => column(detail.cells.shap, cell), [detail, cell]);
  const model = state.status === 'ready' ? state.model : null;
  const levers = useMemo(() => (model ? leversFor(model, values, contributions, ranges) : []), [model, values, contributions, ranges]);
  const [changes, setChanges] = useState<FactorValues>({});
  const t = WHAT_IF_TEXTS[useLocale()];
  const { formatDeg, formatDegSigned } = useFormats();

  if (state.status === 'loading') return <p className="whatif__status">{t.loading}</p>;
  if (state.status === 'failed' || !model) return <p className="whatif__status">{t.failed}</p>;
  if (!levers.length) return <p className="whatif__status">{t.nothingToAdd}</p>;

  const featureByKey = new Map(detail.features.map((f) => [f.key, f]));
  const { delta } = whatIf(model, values, changes, ranges);
  const shown = Math.abs(delta) < NEGLIGIBLE_DEG ? 0 : delta;
  const tone = shown < 0 ? 'cool' : shown > 0 ? 'hot' : 'none';
  const lst = detail.cells.lst[cell] ?? Number.NaN;
  const changed = Object.keys(changes).length > 0;

  return (
    <>
      {levers.map((range) => {
        const feature = featureByKey.get(range.lever.key);
        if (!feature) return null;
        return (
          <LeverSlider
            key={range.lever.key}
            range={range}
            feature={feature}
            value={changes[range.lever.key] ?? range.from}
            onChange={(value) => setChanges((current) => ({ ...current, [range.lever.key]: value }))}
          />
        );
      })}
      <div className="whatif__result">
        {/* Before any move there is no change to state: a big "0.0°" would read as a temperature, so only the hint shows. */}
        <output className={changed ? `whatif__delta num${tone === 'none' ? '' : ` num--${tone}`}` : 'visually-hidden'} aria-live="polite">
          {changed ? formatDegSigned(shown) : t.noChange}
          {changed && <span className="visually-hidden">{t.toSurface}</span>}
        </output>
        <p className="whatif__caption">
          {changed ? t.result(formatDeg(lst + shown), formatDeg(lst)) : t.hint}
        </p>
      </div>
      {changed && (
        <button type="button" className="whatif__reset" onClick={() => setChanges({})}>
          {t.reset}
        </button>
      )}
      <p className="whatif__caveat">
        {t.caveat}
        {levers.some((range) => range.lever.key === 'tree') && t.treesNote}
      </p>
    </>
  );
}

/**
 * "What if" for one picked cell: two or three sliders for what can be changed here, and how the city's own model
 * moves the surface temperature. The model file is fetched the first time the block is opened.
 */
export function WhatIfBlock({ detail, cell }: { detail: CityDetail; cell: number }) {
  // Open from the start: it is the part of the panel a reader most wants to touch, and its model loads only for a place.
  const [open, setOpen] = useState(true);
  const t = WHAT_IF_TEXTS[useLocale()];
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
          <WhatIfBody key={cell} detail={detail} cell={cell} />
        </div>
      )}
    </details>
  );
}
