import { sectionAnswer } from '../domain/answers';
import { causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import type { Profile, Sample } from '../domain/transect';
import type { MapMode } from '../map/CityMap';
import { useWidth } from './hooks';
import { CauseIcon } from './icons';
import { patternFill } from './patterns';
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
  onProbe(sample: Sample | null): void;
  onPick(sample: Sample): void;
  /** While the page is still telling the story, the section is shown but not yet operated. */
  quiet?: boolean;
}

const CHART_H = 196;

export function CauseKey({ model }: { model: CityModel }) {
  const byKey = new Map(model.detail.features.map((f) => [f.key, f]));
  return (
    <ul className="cause-key" aria-label="Что греет сильнее всего, по штриховке">
      {model.causeAreas.features.map(({ properties: { key } }) => (
        <li key={key}>
          <svg className="swatch" width="18" height="12" aria-hidden="true">
            <rect x="0.5" y="0.5" width="17" height="11" style={{ fill: patternFill(key, 'heats') }} />
          </svg>
          <CauseIcon cause={key} size={16} />
          {causeWords(byKey.get(key) ?? { key, label: key, unit: '' }).heatsShort}
        </li>
      ))}
    </ul>
  );
}

/** The cross-section under the map: one sentence, a few quiet controls and the profile itself. */
export function Section({ model, profile, isDefault, drawing, mode, onDraw, onReset, onModeChange, onProbe, onPick, quiet = false }: SectionProps) {
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
        </div>
      </div>
      {mode === 'causes' && <CauseKey model={model} />}
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
