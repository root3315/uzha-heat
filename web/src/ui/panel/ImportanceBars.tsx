import type { CityDetail } from '../../data/contract';
import { formatNumber } from '../../domain/format';
import { directionOf, directionPhrase, importanceRows, isInfluential, type ImportanceRow } from '../../domain/summary';

interface ImportanceBarsProps {
  detail: CityDetail;
  activeKey?: string;
  onShowFactor?(key: string): void;
}

function BarContent({ row, max }: { row: ImportanceRow; max: number }) {
  const direction = directionOf(row.correlation);
  return (
    <>
      <span className="bars__label">
        {row.feature.label}
        <span className="bars__hint">{directionPhrase(direction)}</span>
      </span>
      <span className="bars__track" aria-hidden>
        <span className={`bars__bar bars__bar--${direction}`} style={{ width: `${(row.meanAbsShap / max) * 100}%` }} />
      </span>
      <span className="bars__value">±{formatNumber(row.meanAbsShap, 2)}°</span>
    </>
  );
}

/** Mean |contribution| per factor, coloured by whether more of it heats or cools. */
export function ImportanceBars({ detail, activeKey, onShowFactor }: ImportanceBarsProps) {
  const all = importanceRows(detail);
  const rows = all.filter(isInfluential);
  const silent = all.filter((row) => !isInfluential(row));
  const max = Math.max(...rows.map((r) => r.meanAbsShap), 0.01);

  return (
    <>
      <ol className="bars">
        {rows.map((row) => (
          <li key={row.feature.key} className={row.feature.key === activeKey ? 'is-active' : undefined}>
            {onShowFactor ? (
              <button
                type="button"
                className="bars__row"
                onClick={() => onShowFactor(row.feature.key)}
                title={`Показать на карте вклад фактора «${row.feature.label}»`}
              >
                <BarContent row={row} max={max} />
              </button>
            ) : (
              <div className="bars__row">
                <BarContent row={row} max={max} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {silent.length > 0 && (
        <p className="bars__silent">
          Не повлияли на модель в этом городе: {silent.map((row) => row.feature.label.toLowerCase()).join(', ')}.
        </p>
      )}
    </>
  );
}
