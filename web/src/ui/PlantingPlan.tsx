import { useEffect, useState } from 'react';
import type { CityDetail, LonLat } from '../data/contract';
import type { MapMark } from '../map/CityMap';
import { formatPeople } from '../domain/people';
import { plantingPlan, type PlantingPlace } from '../domain/plantingPlan';
import { useFormats, useLocale } from './locale';
import { PLAN_TEXTS } from './ui.texts';
import { useTreeModel } from './WhatIf';

const PLACES = 5;

interface PlantingPlanProps {
  detail: CityDetail;
  inside: readonly boolean[];
  onPick: (point: LonLat) => void;
  /** The places as numbered marks for the map once they are known; null when the block closes. */
  onPlan?: (marks: MapMark[] | null) => void;
  /** The marks are on the map already: the block opens with them, so it can also take them away. */
  shown?: boolean;
}

/** The city's five places where trees cool the most people the most; a place opens on the map with its own "what if". */
function PlanBody({ detail, inside, onPick, onPlan }: PlantingPlanProps) {
  const locale = useLocale();
  const t = PLAN_TEXTS[locale];
  const { formatDegSigned } = useFormats();
  const state = useTreeModel(detail.city.id);
  const [plan, setPlan] = useState<PlantingPlace[] | null>(null);

  useEffect(() => {
    if (state.status !== 'ready') return;
    setPlan(null);
    // The whole city through the model takes a moment: let the panel paint "calculating" first.
    const timer = window.setTimeout(() => setPlan(plantingPlan(state.model, detail, inside, PLACES)), 0);
    return () => window.clearTimeout(timer);
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

  if (state.status === 'failed') return <p className="whatif__status">{t.failed}</p>;
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
