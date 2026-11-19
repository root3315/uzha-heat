import { useEffect, useState } from 'react';
import type { CityDetail, LonLat, TreeModel } from '../data/contract';
import type { MapMark } from '../map/CityMap';
import { formatPeople } from '../domain/people';
import type { PlantingPlace } from '../domain/plantingPlan';
import { computePlan } from './planInWorker';
import { useFormats, useLocale } from './locale';
import { PLAN_TEXTS } from './ui.texts';
import { useTreeModel } from './WhatIf';

const PLACES = 5;

type ByOutline<V> = WeakMap<readonly boolean[], V>;

/**
 * A city's plan by its cells and its outline: once calculated, reopening the block (or coming back to the city view)
 * shows it at once; while it is being calculated, a block opened again waits for it instead of starting another.
 * A plan that failed is forgotten, so the next opening tries again.
 */
const planCache = new WeakMap<CityDetail, ByOutline<PlantingPlace[]>>();
const pendingPlans = new WeakMap<CityDetail, ByOutline<Promise<PlantingPlace[]>>>();

const knownPlan = (detail: CityDetail, inside: readonly boolean[]) => planCache.get(detail)?.get(inside) ?? null;

function byOutline<V>(outer: WeakMap<CityDetail, ByOutline<V>>, detail: CityDetail): ByOutline<V> {
  let map = outer.get(detail);
  if (!map) {
    map = new WeakMap();
    outer.set(detail, map);
  }
  return map;
}

function planFor(model: TreeModel, detail: CityDetail, inside: readonly boolean[]): Promise<PlantingPlace[]> {
  const pendings = byOutline(pendingPlans, detail);
  let pending = pendings.get(inside);
  if (!pending) {
    pending = computePlan(model, detail, inside, PLACES).then(
      (computed) => {
        byOutline(planCache, detail).set(inside, computed);
        pendings.delete(inside);
        return computed;
      },
      (error: unknown) => {
        pendings.delete(inside);
        throw error;
      },
    );
    pendings.set(inside, pending);
  }
  return pending;
}

interface PlantingPlanProps {
  detail: CityDetail;
  inside: readonly boolean[];
  onPick: (point: LonLat) => void;
  /** The places as numbered marks for the map once they are known; null when the block closes. */
  onPlan?: (marks: MapMark[] | null) => void;
  /** Start open: the marks are on the map already (so closing can take them away), or there is room to show the list. */
  shown?: boolean;
}

/** The city's five places where trees cool the most people the most; a place opens on the map with its own "what if". */
function PlanBody({ detail, inside, onPick, onPlan }: PlantingPlanProps) {
  const locale = useLocale();
  const t = PLAN_TEXTS[locale];
  const { formatDegSigned } = useFormats();
  const state = useTreeModel(detail.city.id);
  const [plan, setPlan] = useState<PlantingPlace[] | null>(() => knownPlan(detail, inside));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const known = knownPlan(detail, inside);
    setFailed(false);
    if (known) {
      setPlan(known);
      return;
    }
    setPlan(null);
    let alive = true;
    planFor(state.model, detail, inside).then(
      (computed) => alive && setPlan(computed),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [state, detail, inside]);

  useEffect(() => {
    if (!plan?.length) return;
    onPlan?.(
      plan.map((place, i) => ({
        point: place.point,
        label: String(i + 1),
        name: t.mark(i + 1, formatDegSigned(-place.cooling), t.forPeople(formatPeople(place.people, locale))),
      })),
    );
  }, [plan, onPlan, t, formatDegSigned, locale]);

  if (state.status === 'failed' || failed) return <p className="whatif__status">{t.failed}</p>;
  if (!plan) return <p className="whatif__status">{t.computing}</p>;
  if (!plan.length) return <p className="whatif__status">{t.none}</p>;

  return (
    <>
      <ol className="plan">
        {plan.map((place, i) => (
          <li key={place.cell}>
            <button type="button" className="plan__place" onClick={() => onPick(place.point)}>
              <span className="plan__rank num">{i + 1}</span>
              <span className="plan__cooling num num--cool">{formatDegSigned(-place.cooling)}</span>
              <span className="plan__people">{t.forPeople(formatPeople(place.people, locale))}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="whatif__caveat">{t.caveat}</p>
    </>
  );
}

export function PlantingPlanBlock(props: PlantingPlanProps) {
  const [open, setOpen] = useState(Boolean(props.shown));
  const t = PLAN_TEXTS[useLocale()];
  const toggle = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) props.onPlan?.(null);
  };
  return (
    <details className="whatif" open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
      <summary className="whatif__summary">
        <span className="whatif__title">{t.title}</span>
        <span className="whatif__hint">
          {t.compute}
          <svg className="whatif__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" />
          </svg>
        </span>
      </summary>
      {open && (
        <div className="whatif__body">
          <PlanBody key={props.detail.city.id} {...props} />
        </div>
      )}
    </details>
  );
}
