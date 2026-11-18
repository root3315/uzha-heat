import { useEffect, useState } from 'react';
import type { CityDetail, LonLat } from '../data/contract';
import { formatDegSigned } from '../domain/format';
import { formatPeople } from '../domain/people';
import { plantingPlan, type PlantingPlace } from '../domain/plantingPlan';
import { useTreeModel } from './WhatIf';

const PLACES = 5;

interface PlantingPlanProps {
  detail: CityDetail;
  inside: readonly boolean[];
  onPick: (point: LonLat) => void;
}

/** The city's five places where trees cool the most people the most; a place opens on the map with its own "что если". */
function PlanBody({ detail, inside, onPick }: PlantingPlanProps) {
  const state = useTreeModel(detail.city.id);
  const [plan, setPlan] = useState<PlantingPlace[] | null>(null);

  useEffect(() => {
    if (state.status !== 'ready') return;
    setPlan(null);
    // The whole city through the model takes a moment: let the panel paint "считаю" first.
    const timer = window.setTimeout(() => setPlan(plantingPlan(state.model, detail, inside, PLACES)), 0);
    return () => window.clearTimeout(timer);
  }, [state, detail, inside]);

  if (state.status === 'failed') return <p className="whatif__status">Модель не загрузилась. Закройте и откройте блок ещё раз.</p>;
  if (!plan) return <p className="whatif__status">Считаю по всем участкам города…</p>;
  if (!plan.length) return <p className="whatif__status">В городе нет участков, где деревья заметно охладили бы жильё.</p>;

  return (
    <>
      <ol className="plan">
        {plan.map((place, i) => (
          <li key={place.cell}>
            <button type="button" className="plan__place" onClick={() => onPick(place.point)}>
              <span className="plan__rank num">{i + 1}</span>
              <span className="plan__cooling num num--cool">{formatDegSigned(-place.cooling)}</span>
              <span className="plan__people">для {formatPeople(place.people)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="whatif__caveat">
        Посадка на каждом участке: +20 п.п. крон и +0,1 NDVI, не дальше самых зелёных 5 % города. Порядок: градусы охлаждения × число жителей.
        По модели: поверхность, не воздух.
      </p>
    </>
  );
}

export function PlantingPlanBlock(props: PlantingPlanProps) {
  const [open, setOpen] = useState(false);
  return (
    <details className="whatif" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="whatif__summary">
        <span className="whatif__title">Где сажать первым</span>
        <span className="whatif__hint">
          посчитать по городу
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
