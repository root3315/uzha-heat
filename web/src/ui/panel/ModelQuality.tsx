import type { CityDetail } from '../../data/contract';
import { formatNumber } from '../../domain/format';

export function ModelQuality({ detail }: { detail: CityDetail }) {
  const { model, period } = detail;
  return (
    <p className="quality">
      Модель {model.type}: R² {formatNumber(model.r2Cv, 2)}, средняя ошибка {formatNumber(model.maeCv, 1)} °C на пространственной
      кросс-валидации ({model.cv}). Период: {period.label}; снимков Landsat — {period.lstScenes}, Sentinel-2 — {period.s2Scenes}.{' '}
      <a href="#/method">Как это посчитано</a>
    </p>
  );
}
