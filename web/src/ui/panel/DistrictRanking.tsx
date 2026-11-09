import type { CityDetail } from '../../data/contract';
import { colorAt } from '../../domain/colorScales';
import { formatNumber, formatTempDelta } from '../../domain/format';
import type { MapScales } from '../../map/mapMode';

interface DistrictRankingProps {
  detail: CityDetail;
  scales: MapScales;
  onSelect(index: number): void;
}

export function DistrictRanking({ detail, scales, onSelect }: DistrictRankingProps) {
  const ranked = detail.districts.map((d, index) => ({ ...d, index })).sort((a, b) => b.lstMean - a.lstMean);
  return (
    <ol className="ranking">
      {ranked.map((district) => (
        <li key={district.index}>
          <button type="button" className="ranking__row" onClick={() => onSelect(district.index)}>
            <span className="ranking__swatch" style={{ background: colorAt(scales.heat, district.lstMean) }} aria-hidden />
            <span className="ranking__name">{district.name}</span>
            <span className="ranking__value">{formatNumber(district.lstMean, 1)}°</span>
            <span className="ranking__delta">{formatTempDelta(district.lstMean - detail.stats.lstMean)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
