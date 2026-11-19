import { sectionAnswer } from '../domain/answers';
import { causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import type { Profile, Sample } from '../domain/transect';
import type { MapMode } from '../map/CityMap';
import { useWidth } from './hooks';
import { formatPeople, hotFacilities, peopleInHeat, populationCaveat, sparseHeatNote } from '../domain/people';
import { FacilityIcon } from './icons';
import { useFormats, useLocale } from './locale';
import { SECTION_TEXTS } from './ui.texts';
import { HatchSwatch } from './patterns';
import { Phrase } from './Phrase';
import { ProfileChart } from './ProfileChart';

interface SectionProps {
  model: CityModel;
  profile: Profile;
  isDefault: boolean;
  drawing: boolean;
  mode: MapMode;
  onDraw(): void;
  onReset(): void;
  onModeChange(mode: MapMode): void;
  /** People on the map; undefined when the city has no population data. */
  people?: boolean;
  onPeopleChange?(on: boolean): void;
  onProbe(sample: Sample | null): void;
  onPick(sample: Sample): void;
  /** While the page is still telling the story, the section is shown but not yet operated. */
  quiet?: boolean;
  /** Draw the keys for causes and people here; off where the map carries them itself. */
  keys?: boolean;
}

const CHART_H = 196;

/** Every hatch on the map gets its swatch and name: an unexplained hatch is worse than a second row. */
export function CauseKey({ model }: { model: CityModel }) {
  const locale = useLocale();
  const byKey = new Map(model.detail.features.map((f) => [f.key, f]));
  return (
    <ul className="cause-key" aria-label={SECTION_TEXTS[locale].causeKey}>
      {model.causeAreas.features.map(({ properties: { key } }) => (
        <li key={key}>
          <HatchSwatch hatch={key} direction="heats" />
          {causeWords(byKey.get(key) ?? { key, label: key, unit: '' }, locale).heatsShort}
        </li>
      ))}
    </ul>
  );
}

/** What the "People" layer shows, how many live in the heat, and how sure that number is. */
export function PeopleKey({ model }: { model: CityModel }) {
  const { detail } = model;
  const locale = useLocale();
  const t = SECTION_TEXTS[locale];
  const { formatTemp, formatNumber } = useFormats();
  const inHeat = peopleInHeat(detail, model.inside);
  const facilities = hotFacilities(detail, model.source.cellAt).filter((f) => model.inside[model.source.cellAt([f.lon, f.lat])]);
  if (!inHeat) return null;
  return (
    <div className="people-key">
      <ul className="cause-key" aria-label={t.peopleKey}>
        <li>
          <svg className="swatch" width="18" height="12" aria-hidden="true">
            <circle cx="5" cy="6" r="2" className="people-key__dot" />
            <circle cx="13" cy="6" r="4" className="people-key__dot" />
          </svg>
          {t.residents}
        </li>
        <li>
          <FacilityIcon type="school" size={16} />
          <FacilityIcon type="kindergarten" size={16} />
          <FacilityIcon type="clinic" size={16} />
          {t.facilities(formatNumber(facilities.length, 0))}
        </li>
      </ul>
      <p className="people-key__note">
        {t.peopleNote(formatTemp(detail.stats.lstP90), formatPeople(inHeat.people, locale))} {sparseHeatNote(inHeat, locale) ?? ''}{' '}
        {detail.population ? populationCaveat(detail.population.year, locale) : ''}
      </p>
    </div>
  );
}

/** The cross-section under the map: one sentence, a few quiet controls and the profile itself. */
export function Section({ model, profile, isDefault, drawing, mode, onDraw, onReset, onModeChange, people, onPeopleChange, onProbe, onPick, quiet = false, keys = true }: SectionProps) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const { detail } = model;
  const locale = useLocale();
  const t = SECTION_TEXTS[locale];
  return (
    <section className="section" aria-label={t.section}>
      <div className="section__head">
        <p className="section__answer">
          <Phrase spans={sectionAnswer(profile, detail.stats.lstMean, detail.features, locale)} />
        </p>
        <div className="section__tools" hidden={quiet}>
          <button type="button" className="pill pill--small" aria-pressed={drawing} onClick={onDraw}>
            {drawing ? t.drawing : t.newSection}
          </button>
          <button
            type="button"
            className="pill pill--small"
            onClick={onReset}
            disabled={isDefault}
            title={isDefault ? t.alreadyHottestTitle : t.hottestTitle}
          >
            {isDefault ? t.alreadyHottest : t.hottest}
          </button>
          <button type="button" className="pill pill--small" aria-pressed={mode === 'causes'} onClick={() => onModeChange(mode === 'causes' ? 'temperature' : 'causes')}>
            {t.causesOnMap}
          </button>
          {people !== undefined && onPeopleChange && (
            <button type="button" className="pill pill--small" aria-pressed={people} onClick={() => onPeopleChange(!people)}>
              {t.people}
            </button>
          )}
        </div>
      </div>
      {keys && mode === 'causes' && <CauseKey model={model} />}
      {keys && people && <PeopleKey model={model} />}
      <div ref={ref} className="section__chart">
        <ProfileChart
          profile={profile}
          levels={model.levels}
          cityMean={detail.stats.lstMean}
          features={detail.features}
          width={width}
          height={CHART_H}
          onProbe={onProbe}
          onPick={onPick}
        />
      </div>
    </section>
  );
}
