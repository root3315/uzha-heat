import { useMemo } from 'react';
import type { EnergyMethod } from '../data/contract';
import { loadValidation } from '../data/load';
import type { CityValidation, ModisPlatform } from '../data/validation';
import type { CityModel } from '../domain/cityModel';
import { cityName, featureLabel, featureUnit, periodText, surfaceLabel } from '../domain/dataTexts';
import { formatWatts } from '../domain/energy';
import { groupShares } from '../domain/factorGroups';
import type { Formats } from '../domain/format';
import { cutAmount, leverByKey } from '../domain/whatIf';
import { islandByRingWidth, ringSpread } from '../domain/ringSensitivity';
import type { Locale } from '../i18n/locale';
import { useAsync } from './hooks';
import { Link } from './Link';
import { useFormats, useLocale, useTexts } from './locale';
import { METHOD_TEXTS } from './MethodPage.texts';
import { toolHref } from './routing';

type MethodTexts = (typeof METHOD_TEXTS)['en'];

/** Where each step of the energy balance comes from, in the order of the steps in the texts. */
const ENERGY_STEP_URLS = [
  'https://doi.org/10.1016/S0034-4257(00)00205-4',
  'https://doi.org/10.1016/j.rse.2004.02.003',
  'https://physics.nist.gov/cgi-bin/cuu/Value?sigma',
  'https://doi.org/10.1029/WR011i005p00742',
  'https://doi.org/10.1061/(ASCE)0733-9437(2007)133:4(380)',
  'https://doi.org/10.1016/S0022-1694(99)00202-4',
  'https://doi.org/10.1016/S1464-1909(99)00128-8',
  'https://doi.org/10.3390/s7060979',
  'https://doi.org/10.1016/S0022-1694(98)00253-4',
];

function EnergySection({ energy }: { energy: EnergyMethod }) {
  const locale = useLocale();
  const t = useTexts(METHOD_TEXTS).energy;
  const { formatDeg, formatNumber } = useFormats();
  return (
    <>
      <h2 className="method__subtitle">{t.title}</h2>
      <p>{t.intro(energy.localHour)}</p>
      <p>
        {t.conditions(
          formatWatts(energy.solarWm2, locale),
          formatDeg(energy.airC),
          formatNumber(energy.humidityPct, 0),
          formatWatts(energy.longwaveDownWm2, locale),
          formatDeg(energy.hotAnchorC),
          formatDeg(energy.coldAnchorC),
        )}
      </p>
      <dl className="method__factors">
        {t.steps.map((step, i) => (
          <div key={step.name}>
            <dt>{step.name}</dt>
            <dd>
              {step.formula}.{' '}
              <a className="text-link" href={ENERGY_STEP_URLS[i]} target="_blank" rel="noopener">
                {step.cite}&nbsp;↗
              </a>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        {t.storage}{' '}
        <a className="text-link" href="https://doi.org/10.4324/9780203407219" target="_blank" rel="noopener">
          Oke 1987&nbsp;↗
        </a>
      </p>
      <dl className="method__factors">
        {energy.surfaces.map((surface) => (
          <div key={surface.key}>
            <dt>{surfaceLabel(surface, locale)}</dt>
            <dd>{t.surface(formatNumber(surface.heatCapacity, 2), formatNumber(surface.conductivity, 2), formatNumber(surface.admittance, 0))}</dd>
          </div>
        ))}
      </dl>
      <p>{t.limitsLead}</p>
      <ul className="method__limits">
        {t.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </>
  );
}

const RING_WIDTHS_M = [500, 1000, 1500];

/** Checks a judge would ask for: does the island hold for another ring, and what carries the heat once correlated factors are read together. */
function Robustness({ model }: { model: CityModel }) {
  const locale = useLocale();
  const t = useTexts(METHOD_TEXTS).robustness;
  const { formatDeg, formatDegSigned, formatNumber, formatPercent } = useFormats();
  const { detail, inside, outline } = model;
  const rings = useMemo(
    () => (outline ? islandByRingWidth(detail.cells.lst, detail.cells.lon, detail.cells.lat, inside, outline, RING_WIDTHS_M) : []),
    [detail, inside, outline],
  );
  const groups = useMemo(() => groupShares(detail, locale, inside), [detail, locale, inside]);
  const spread = ringSpread(rings);
  // Without the outline there is no ring and no "inside": nothing here would mean what it says.
  if (!outline) return null;
  return (
    <>
      <h2 className="method__subtitle">{t.title}</h2>
      {rings.length > 0 && (
        <>
          <p>
            {t.rings}
            {spread !== null && t.spread(formatDeg(spread))}
          </p>
          <dl className="method__factors">
            {rings.map((ring) => (
              <div key={ring.widthM}>
                <dt>{t.ring(formatNumber(ring.widthM / 1000, 1))}</dt>
                <dd>
                  {ring.island
                    ? t.ringValue(
                        formatDegSigned(ring.island.intensity),
                        formatDeg(ring.island.inside),
                        formatDeg(ring.island.outside),
                        formatNumber(ring.island.outsideCount, 0),
                      )
                    : t.tooFew}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {groups.length > 0 && (
        <>
          <p>{t.groups}</p>
          <dl className="method__factors">
            {groups.map((group) => (
              <div key={group.id}>
                <dt>{group.label}</dt>
                <dd>{t.group(formatPercent(group.share), formatNumber(group.meanAbs, 1))}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </>
  );
}

/** "1.5km" from the validation file → "1.5" in English, "1,5" in Russian. */
const ringWidth = (width: string, locale: Locale) => {
  const number = width.replace('km', '');
  return locale === 'ru' ? number.replace('.', ',') : number;
};

/** "+2.2° with a 1 km ring, +2.4° with a 1.5 km ring", or null when no ring had enough pixels. */
function islandLine(platform: ModisPlatform, when: 'day' | 'night', t: MethodTexts['modis'], f: Formats, locale: Locale): string | null {
  const rings = Object.entries(platform.heatIsland[when]).filter((entry): entry is [string, number] => entry[1] !== null);
  return rings.length ? rings.map(([width, value]) => t.ring(f.formatDegSigned(value), ringWidth(width, locale))).join(', ') : null;
}

/** "warmer" only when every ring says so; a mixed night is stated as a difference. */
function nightSentence(platform: ModisPlatform, t: MethodTexts['modis'], f: Formats, locale: Locale): string | null {
  const night = islandLine(platform, 'night', t, f, locale);
  if (!night) return null;
  const values = Object.values(platform.heatIsland.night).filter((v): v is number => v !== null);
  const lead = values.every((v) => v > 0) ? t.warmer : values.every((v) => v < 0) ? t.cooler : t.differs;
  return t.night(platform.product, platform.overpassLocal.night, lead, night, islandLine(platform, 'day', t, f, locale));
}

/** Our Landsat surface against NASA MODIS, and the night the Landsat pass cannot see. */
function ModisCheck({ check }: { check: CityValidation }) {
  const locale = useLocale();
  const t = useTexts(METHOD_TEXTS).modis;
  const f = useFormats();
  const { aqua, terra } = check;
  if (!aqua && !terra) return null;
  const night = [aqua, terra].flatMap((p) => (p ? [nightSentence(p, t, f, locale)] : [])).find((sentence) => sentence !== null) ?? null;
  return (
    <>
      <h2 className="method__subtitle">{t.title}</h2>
      <p>{t.intro}</p>
      <dl className="method__factors">
        {[aqua, terra].flatMap((p) =>
          p?.day
            ? [
                <div key={p.product}>
                  <dt>{t.day(p.product, p.overpassLocal.day)}</dt>
                  <dd>
                    {t.match(
                      f.formatNumber(p.day.r, 2),
                      p.day.bias >= 0,
                      f.formatDeg(Math.abs(p.day.bias)),
                      f.formatNumber(p.day.rmse, 1),
                      f.formatNumber(p.day.n, 0),
                    )}
                  </dd>
                </div>,
              ]
            : [],
        )}
      </dl>
      {night && (
        <p>
          {night} {t.nightNote}
        </p>
      )}
    </>
  );
}

/** How the map was made, in the same plain voice as the map. Every number comes from the city's data. */
export function MethodPage({ model }: { model: CityModel }) {
  const locale = useLocale();
  const t = useTexts(METHOD_TEXTS);
  const { formatDeg, formatNumber, formatPercent } = useFormats();
  const { detail, levels } = model;
  const { grid, period, features, model: fit, city } = detail;
  const name = cityName(city, locale);
  const periodLabel = periodText(period.label, locale);
  const step = (levels.thresholds[1] ?? 0) - (levels.thresholds[0] ?? 0);
  const validation = useAsync(loadValidation, []);
  const check = validation.status === 'ready' ? validation.data?.cities[city.id] : undefined;
  return (
    <main className="method">
      <h1 className="method__title">{t.title}</h1>
      <p className="method__lead">
        {name}. <Link className="text-link" href={toolHref(city.id)}>{t.back}</Link>
      </p>

      <p>{t.cells(name, grid.cellSizeM, formatNumber(grid.count, 0), periodLabel, period.lstScenes, features.length)}</p>
      <p>{t.model(fit.type, formatPercent(fit.r2Cv), formatNumber(fit.r2Cv, 2), formatDeg(fit.maeCv))}</p>
      <p>{t.shap(formatDeg(fit.baseValue))}</p>
      <p>{t.island}</p>
      <p>{t.ndvi}</p>
      <p>{t.whatIf(cutAmount(leverByKey('built'), locale) ?? '', cutAmount(leverByKey('roads'), locale) ?? '')}</p>
      <p>{t.isotherms(formatNumber(step, 0))}</p>

      <h2 className="method__subtitle">{t.factors}</h2>
      <dl className="method__factors">
        {features.map((feature) => (
          <div key={feature.key}>
            <dt>{featureLabel(feature, locale)}</dt>
            <dd>{[featureUnit(feature, locale), t.sources[feature.key]].filter(Boolean).join(', ')}</dd>
          </div>
        ))}
      </dl>

      <Robustness model={model} />
      {check && <ModisCheck check={check} />}

      {detail.energy && <EnergySection energy={detail.energy} />}

      <h2 className="method__subtitle">{t.limitsTitle}</h2>
      <ul className="method__limits">
        {t.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
        <li>{t.layers(periodLabel, detail.population?.year ?? null)}</li>
      </ul>
    </main>
  );
}
