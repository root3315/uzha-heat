import { useEffect, useMemo, useState } from 'react';
import type { CityDetail, FeatureMeta, TreeModel } from '../data/contract';
import { loadTreeModel } from '../data/load';
import { formatDeg, formatDegSigned, formatFactorValue } from '../domain/format';
import { cityRanges, cutText, leversFor, whatIf, type FactorValues, type LeverRange } from '../domain/whatIf';

/** What each slider is called, how its value is said aloud (screen readers get the unit in words) and its noun for a cut. */
const LEVER_TEXT: Record<string, { label: string; spoken: (value: string) => string; noun?: string }> = {
  tree: { label: 'Деревья', spoken: (v) => `деревья на ${v} площади` },
  ndvi: { label: 'Зелень, NDVI', spoken: (v) => `NDVI ${v}` },
  albedo: { label: 'Светлые крыши и покрытия, альбедо', spoken: (v) => `альбедо ${v}` },
  built: { label: 'Застройка', spoken: (v) => `застроено ${v} площади`, noun: 'застройки' },
  roads: { label: 'Дороги', spoken: (v) => `${v} дорог`, noun: 'дорог' },
};

/** Changes smaller than this read as no change. */
const NEGLIGIBLE_DEG = 0.05;

type ModelState = { status: 'loading' } | { status: 'ready'; model: TreeModel } | { status: 'failed' };

function useTreeModel(cityId: string): ModelState {
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

interface SliderProps {
  range: LeverRange;
  feature: FeatureMeta;
  value: number;
  onChange: (value: number) => void;
}

function LeverSlider({ range, feature, value, onChange }: SliderProps) {
  const { lever, from, to } = range;
  const text = LEVER_TEXT[lever.key] ?? { label: feature.label, spoken: (v: string) => `${feature.label} ${v}` };
  const id = `whatif-${lever.key}`;
  const say = (v: number) => formatFactorValue(feature, v);
  const up = lever.direction === 'up';
  // The input measures how far from "сейчас": 0 is the cell as it is, always on the step grid, so the slider can
  // always come back to it; the grid divides the span exactly, so the far end is reachable too.
  const span = Math.abs(to - from);
  const steps = Math.max(1, Math.round(span / lever.step));
  const amount = Math.min(span, Math.abs(value - from));
  const at = span > 0 ? amount / span : 0;
  const cut = range.bound === 'cut' ? cutText(lever) : undefined;
  const reason = cut ? `${cut}${text.noun ? ` ${text.noun}` : ''}` : `${up ? 'верхние' : 'нижние'} 5 % города`;
  const limit = `до ${say(to)} — ${reason}`;
  return (
    <div className="whatif__lever">
      <p className="whatif__head">
        <label htmlFor={id}>{text.label}</label>
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
          max={span}
          step={span / steps}
          value={amount}
          aria-valuetext={`${text.spoken(say(value))}, сейчас ${say(from)}`}
          aria-describedby={`${id}-limit`}
          onChange={(event) => {
            const moved = Number(event.currentTarget.value);
            onChange(up ? from + moved : from - moved);
          }}
        />
      </div>
      <p className="whatif__ends">
        {/* The value now is already in aria-valuetext; the limit is the slider's description. */}
        <span aria-hidden="true">сейчас {say(from)}</span>
        <span id={`${id}-limit`}>{limit}</span>
      </p>
    </div>
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

  if (state.status === 'loading') return <p className="whatif__status">Загружаю модель города…</p>;
  if (state.status === 'failed' || !model) return <p className="whatif__status">Модель не загрузилась. Закройте и откройте блок ещё раз.</p>;
  if (!levers.length) return <p className="whatif__status">Здесь нечего прибавить: деревьев, зелени и светлых покрытий уже столько, сколько бывает в городе.</p>;

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
        <output className={`whatif__delta num${tone === 'none' ? ' whatif__delta--idle' : ` num--${tone}`}`} aria-live="polite">
          {/* Before any move there is no change to state: a big "0,0°" would read as a temperature. */}
          {changed ? formatDegSigned(shown) : '—'}
          <span className="visually-hidden">{changed ? ' к температуре поверхности здесь' : ' пока без изменений'}</span>
        </output>
        <p className="whatif__caption">
          {changed ? `к поверхности здесь: около ${formatDeg(lst + shown)} вместо ${formatDeg(lst)}` : 'подвиньте ползунок, модель пересчитает температуру поверхности'}
        </p>
      </div>
      {changed && (
        <button type="button" className="whatif__reset" onClick={() => setChanges({})}>
          Вернуть как есть
        </button>
      )}
      <p className="whatif__caveat">
        По модели: связь в данных, не эксперимент; поверхность, не воздух.
        {levers.some((range) => range.lever.key === 'tree') && ' «Деревья» здесь только доля крон; трава и листва под ними идут в NDVI, поэтому зелень меняет больше.'}
      </p>
    </>
  );
}

/**
 * "Что если" for one picked cell: two or three sliders for what can be changed here, and how the city's own model
 * moves the surface temperature. The model file is fetched the first time the block is opened.
 */
export function WhatIfBlock({ detail, cell }: { detail: CityDetail; cell: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="whatif" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="whatif__summary">
        <span className="whatif__title">Что если</span>
        <span className="whatif__hint">
          пересчитать по модели
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
