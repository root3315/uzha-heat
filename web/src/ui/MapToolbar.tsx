import type { FeatureMeta } from '../data/contract';
import type { Granularity, MapMode } from '../map/mapMode';
import { Segmented } from './Segmented';

interface MapToolbarProps {
  features: FeatureMeta[];
  mode: MapMode;
  onModeChange(mode: MapMode): void;
  granularity: Granularity;
  onGranularityChange(granularity: Granularity): void;
  hasDistricts: boolean;
}

type ModeKind = MapMode['kind'];

const MODE_OPTIONS: { value: ModeKind; label: string }[] = [
  { value: 'lst', label: 'Температура' },
  { value: 'dominant', label: 'Главная причина' },
  { value: 'shap', label: 'Вклад фактора' },
];

export function MapToolbar({ features, mode, onModeChange, granularity, onGranularityChange, hasDistricts }: MapToolbarProps) {
  const firstKey = features[0]?.key;

  const changeKind = (kind: ModeKind) => {
    if (kind === 'shap') {
      if (mode.kind !== 'shap' && firstKey) onModeChange({ kind: 'shap', key: firstKey });
      return;
    }
    onModeChange({ kind });
  };

  return (
    <div className="toolbar">
      <Segmented label="Что показывать на карте" options={MODE_OPTIONS} value={mode.kind} onChange={changeKind} />
      {mode.kind === 'shap' && (
        <label className="toolbar__select">
          <span className="visually-hidden">Фактор</span>
          <select value={mode.key} onChange={(event) => onModeChange({ kind: 'shap', key: event.target.value })}>
            {features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {hasDistricts && (
        <Segmented
          label="Детализация"
          options={[
            { value: 'cells', label: '200 м' },
            { value: 'districts', label: 'Районы' },
          ]}
          value={granularity}
          onChange={onGranularityChange}
        />
      )}
    </div>
  );
}
