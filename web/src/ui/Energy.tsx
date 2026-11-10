import type { Fluxes } from '../data/contract';
import { SINKS, formatWatts, sinkShares, type CityEnergy, type EnergyView, type Sink } from '../domain/energy';
import { capitalize } from '../domain/answers';
import { SinkIcon } from './icons';
import { usePatternFill } from './patterns';

/** Heating the air is the solid ink; evaporation and the ground are hatched, so the bar prints in black and white. */
function useSinkFill(): (sink: Sink) => string {
  const fill = usePatternFill();
  return (sink) => (sink === 'h' ? 'var(--ink)' : fill(`flux-${sink}`, sink === 'le' ? 'cools' : 'heats'));
}

/** Net radiation as one bar, split into where it goes. */
export function EnergyBar({ fluxes, label }: { fluxes: Fluxes; label: string }) {
  const fill = useSinkFill();
  const shares = sinkShares(fluxes);
  let x = 0;
  const parts = SINKS.map(({ key, label: name }) => {
    const part = { key, name, x, width: shares[key] };
    x += shares[key];
    return part;
  });
  const said = SINKS.map(({ key, label: name }) => `${name} ${formatWatts(fluxes[key])}`).join(', ');
  return (
    <svg className="energy__bar" width="100%" height="18" role="img" aria-label={`${label}: ${said}`}>
      {parts.map((p) => (
        <rect key={p.key} className="energy__part" x={`${p.x * 100}%`} y="0.5" width={`${p.width * 100}%`} height="17" style={{ fill: fill(p.key) }} />
      ))}
    </svg>
  );
}

function SinkSwatch({ sink }: { sink: Sink }) {
  const fill = useSinkFill();
  return (
    <svg className="swatch" width="18" height="12" aria-hidden="true">
      <rect x="0.5" y="0.5" width="17" height="11" style={{ fill: fill(sink) }} />
    </svg>
  );
}

/** What each segment of the bar is, once per block. */
export function EnergyKey() {
  return (
    <ul className="energy__key">
      {SINKS.map(({ key, label }) => (
        <li key={key}>
          <SinkSwatch sink={key} />
          <SinkIcon sink={key} size={16} />
          {label}
        </li>
      ))}
    </ul>
  );
}

function SinkFigures({ fluxes }: { fluxes: Fluxes }) {
  return (
    <dl className="energy__figures">
      {SINKS.map(({ key, label }) => (
        <div key={key}>
          <dt>
            <SinkSwatch sink={key} />
            <SinkIcon sink={key} size={16} />
            {capitalize(label)}
          </dt>
          <dd className="num">{formatWatts(fluxes[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Физика участка": where the place's sunlight goes at about 11 am, and why it stays warm into the evening. */
export function EnergyBlock({ view, title }: { view: EnergyView; title: string }) {
  const { fluxes } = view;
  return (
    <section className="energy" aria-label={title}>
      <h2 className="energy__title">{title}</h2>
      <p className="energy__lead">{view.verdict}</p>
      <p className="energy__intake">
        Поглощено солнца <span className="num">{formatWatts(fluxes.sAbs)}</span>, после теплового излучения остаётся{' '}
        <span className="num">{formatWatts(fluxes.rn)}</span>. Куда оно уходит:
      </p>
      <EnergyBar fluxes={fluxes} label={title} />
      <SinkFigures fluxes={fluxes} />
      {view.comparison && <p className="energy__text">{view.comparison}</p>}
      {view.storage && <p className="energy__text">{view.storage}</p>}
      <p className="energy__note">{view.caveat}</p>
    </section>
  );
}

const SUMMARY_ROWS = [
  ['hot', 'Горячая десятая часть'],
  ['mean', 'Весь город'],
  ['green', 'Зелёная десятая часть'],
] as const;

/** The city at a glance: the hottest tenth, the mean and the greenest tenth on one scale of shares. */
export function EnergySummary({ summary }: { summary: CityEnergy }) {
  return (
    <div className="energy-summary">
      <ul className="energy-summary__rows">
        {SUMMARY_ROWS.map(([key, label]) => {
          const fluxes = summary[key];
          return (
            <li key={key}>
              <p className="energy-summary__head">
                <span>{label}</span>
                <span className="num">
                  в воздух {formatWatts(fluxes.h)} · на испарение {formatWatts(fluxes.le)}
                </span>
              </p>
              <EnergyBar fluxes={fluxes} label={label} />
            </li>
          );
        })}
      </ul>
      <EnergyKey />
    </div>
  );
}
