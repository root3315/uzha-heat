import type { Fluxes } from '../data/contract';
import { SINKS, formatWatts, sinkLabel, sinkShares, type CityEnergy, type EnergyView, type Sink } from '../domain/energy';
import { capitalize } from '../domain/phrase';
import { useLocale } from './locale';
import { ENERGY_UI_TEXTS } from './ui.texts';
import { SinkIcon } from './icons';
import { HatchSwatch, usePatternFill } from './patterns';

/** Heating the air is the solid ink; evaporation and the ground are hatched, so the bar prints in black and white. */
function useSinkFill(): (sink: Sink) => string {
  const fill = usePatternFill();
  return (sink) => (sink === 'h' ? 'var(--ink)' : fill(`flux-${sink}`, sink === 'le' ? 'cools' : 'heats'));
}

/** Net radiation as one bar, split into where it goes. */
export function EnergyBar({ fluxes, label }: { fluxes: Fluxes; label: string }) {
  const fill = useSinkFill();
  const locale = useLocale();
  const shares = sinkShares(fluxes);
  let x = 0;
  const parts = SINKS.map((key) => {
    const part = { key, x, width: shares[key] };
    x += shares[key];
    return part;
  });
  const said = SINKS.map((key) => `${sinkLabel(key, locale)} ${formatWatts(fluxes[key], locale)}`).join(', ');
  return (
    <svg className="energy__bar" width="100%" height="18" role="img" aria-label={`${label}: ${said}`}>
      {parts.map((p) => (
        <rect key={p.key} className="energy__part" x={`${p.x * 100}%`} y="0.5" width={`${p.width * 100}%`} height="17" style={{ fill: fill(p.key) }} />
      ))}
    </svg>
  );
}

function SinkSwatch({ sink }: { sink: Sink }) {
  return sink === 'h' ? <HatchSwatch solid="var(--ink)" /> : <HatchSwatch hatch={`flux-${sink}`} direction={sink === 'le' ? 'cools' : 'heats'} />;
}

/** What each segment of the bar is, once per block. */
export function EnergyKey() {
  const locale = useLocale();
  return (
    <ul className="energy__key">
      {SINKS.map((key) => (
        <li key={key}>
          <SinkSwatch sink={key} />
          <SinkIcon sink={key} size={16} />
          {sinkLabel(key, locale)}
        </li>
      ))}
    </ul>
  );
}

function SinkFigures({ fluxes }: { fluxes: Fluxes }) {
  const locale = useLocale();
  return (
    <dl className="energy__figures">
      {SINKS.map((key) => (
        <div key={key}>
          <dt>
            <SinkSwatch sink={key} />
            <SinkIcon sink={key} size={16} />
            {capitalize(sinkLabel(key, locale))}
          </dt>
          <dd className="num">{formatWatts(fluxes[key], locale)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Physics of the place": where the place's sunlight goes at about 11 am, and why it stays warm into the evening. */
export function EnergyBlock({ view, title }: { view: EnergyView; title: string }) {
  const { fluxes } = view;
  const locale = useLocale();
  const { intake } = ENERGY_UI_TEXTS[locale];
  return (
    <section className="energy" aria-label={title}>
      <h2 className="energy__title">{title}</h2>
      <p className="energy__lead">{view.verdict}</p>
      <p className="energy__intake">
        {intake.before}
        <span className="num">{formatWatts(fluxes.sAbs, locale)}</span>
        {intake.middle}
        <span className="num">{formatWatts(fluxes.rn, locale)}</span>
        {intake.after}
      </p>
      <EnergyBar fluxes={fluxes} label={title} />
      <SinkFigures fluxes={fluxes} />
      {view.comparison && <p className="energy__text">{view.comparison}</p>}
      {view.storage && <p className="energy__text">{view.storage}</p>}
      <p className="energy__note">{view.caveat}</p>
    </section>
  );
}

const SUMMARY_ROWS = ['hot', 'mean', 'green'] as const;

/** The city at a glance: the hottest tenth, the mean and the greenest tenth on one scale of shares. */
export function EnergySummary({ summary }: { summary: CityEnergy }) {
  const locale = useLocale();
  const t = ENERGY_UI_TEXTS[locale];
  return (
    <div className="energy-summary">
      <ul className="energy-summary__rows">
        {SUMMARY_ROWS.map((key) => {
          const fluxes = summary[key];
          const label = t.rows[key];
          return (
            <li key={key}>
              <p className="energy-summary__head">
                <span>{label}</span>
                <span className="num">{t.split(formatWatts(fluxes.h, locale), formatWatts(fluxes.le, locale))}</span>
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
