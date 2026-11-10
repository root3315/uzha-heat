import { sectionAnswer } from '../domain/answers';
import { causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import { formatNumber } from '../domain/format';
import type { Profile, Sample } from '../domain/transect';
import type { MapMode } from '../map/CityMap';
import { useWidth } from './hooks';
import { formatPeople, hotFacilities, peopleInHeat, populationCaveat } from '../domain/people';
import { CauseIcon, FacilityIcon } from './icons';
import { usePatternFill } from './patterns';
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
}

const CHART_H = 196;

export function CauseKey({ model }: { model: CityModel }) {
  const fill = usePatternFill();
  const byKey = new Map(model.detail.features.map((f) => [f.key, f]));
  return (
    <ul className="cause-key" aria-label="Что греет сильнее всего, по штриховке">
      {model.causeAreas.features.map(({ properties: { key } }) => (
        <li key={key}>
          <svg className="swatch" width="18" height="12" aria-hidden="true">
            <rect x="0.5" y="0.5" width="17" height="11" style={{ fill: fill(key, 'heats') }} />
          </svg>
          <CauseIcon cause={key} size={16} />
          {causeWords(byKey.get(key) ?? { key, label: key, unit: '' }).heatsShort}
        </li>
      ))}
    </ul>
  );
}

/** What the "Люди" layer shows, how many live in the heat, and how sure that number is. */
export function PeopleKey({ model }: { model: CityModel }) {
  const { detail } = model;
  const inHeat = peopleInHeat(detail);
  const facilities = hotFacilities(detail, model.source.cellAt);
  if (!inHeat) return null;
  return (
    <div className="people-key">
      <ul className="cause-key" aria-label="Что на карте в слое «Люди»">
        <li>
          <svg className="swatch" width="18" height="12" aria-hidden="true">
            <circle cx="5" cy="6" r="2" className="people-key__dot" />
            <circle cx="13" cy="6" r="4" className="people-key__dot" />
          </svg>
          жители участка
        </li>
        <li>
          <FacilityIcon type="school" size={16} />
          <FacilityIcon type="kindergarten" size={16} />
          <FacilityIcon type="clinic" size={16} />
          школы, сады и поликлиники в горячей десятой части: {formatNumber(facilities.length, 0)}
        </li>
      </ul>
      <p className="people-key__note">
        На самых горячих участках живут {formatPeople(inHeat.people)}. {detail.population ? populationCaveat(detail.population.year) : ''}
      </p>
    </div>
  );
}

/** The cross-section under the map: one sentence, a few quiet controls and the profile itself. */
export function Section({ model, profile, isDefault, drawing, mode, onDraw, onReset, onModeChange, people, onPeopleChange, onProbe, onPick, quiet = false }: SectionProps) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const { detail } = model;
  return (
    <section className="section" aria-label="Разрез">
      <div className="section__head">
        <p className="section__answer">
          <Phrase spans={sectionAnswer(profile, detail.stats.lstMean, detail.features)} />
        </p>
        <div className="section__tools" hidden={quiet}>
          <button type="button" className="pill pill--small" aria-pressed={drawing} onClick={onDraw}>
            {drawing ? 'Ведите по карте' : 'Новый разрез'}
          </button>
          <button type="button" className="pill pill--small" onClick={onReset} disabled={isDefault}>
            Через самое жаркое
          </button>
          <button type="button" className="pill pill--small" aria-pressed={mode === 'causes'} onClick={() => onModeChange(mode === 'causes' ? 'temperature' : 'causes')}>
            Причины на карте
          </button>
          {people !== undefined && onPeopleChange && (
            <button type="button" className="pill pill--small" aria-pressed={people} onClick={() => onPeopleChange(!people)}>
              Люди
            </button>
          )}
        </div>
      </div>
      {mode === 'causes' && <CauseKey model={model} />}
      {people && <PeopleKey model={model} />}
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
