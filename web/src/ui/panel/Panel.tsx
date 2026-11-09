import type { ReactNode } from 'react';
import { capitalize, type Advice } from '../../domain/answers';
import type { Evidence as EvidenceData } from '../../domain/recommendations';
import type { CityModel } from '../../domain/cityModel';
import { formatDeg, formatDegSigned } from '../../domain/format';
import type { CauseRow, PanelContent } from '../panelContent';
import { CauseIcon } from '../icons';
import { directionOf, patternFill } from '../patterns';
import { Phrase } from '../Phrase';
import { Ramp } from './Ramp';

interface PanelProps {
  model: CityModel;
  content: PanelContent;
  /** Small controls above the title: the city switcher, "весь город", the report link. */
  header: ReactNode;
  footer?: ReactNode;
  /** In the report every cause is listed, nothing is folded. */
  expanded?: boolean;
}

/** Bars share one scale, so a cause of +2° is visibly half of one of +4°. */
const BAR_SCALE_MIN = 6;

function CauseBar({ row, scale }: { row: CauseRow & { note: string }; scale: number }) {
  const direction = directionOf(row.value);
  const share = Math.min(1, Math.abs(row.value) / scale);
  return (
    <div className="cause">
      <p className="cause__head">
        <span className="cause__name">
          <CauseIcon cause={row.key} size={22} />
          {row.label}
        </span>
        <span className={`cause__value num num--${direction === 'heats' ? 'hot' : 'cool'}`}>{formatDegSigned(row.value)}</span>
      </p>
      <svg className="cause__bar" width="100%" height="16" role="img" aria-label={`${row.label}: ${formatDegSigned(row.value)}`}>
        <line className="cause__track" x1="0" x2="100%" y1="15.5" y2="15.5" />
        <rect className="cause__fill" x="0" y="1" height="14" style={{ width: `${share * 100}%`, fill: patternFill(row.key, direction) }} />
      </svg>
      <p className="cause__note">{row.note}</p>
    </div>
  );
}

function RestRows({ rows }: { rows: CauseRow[] }) {
  return (
    <ul className="rest__list">
      {rows.map((row) => (
        <li key={row.key}>
          <svg className="swatch" width="18" height="12" aria-hidden="true">
            <rect x="0.5" y="0.5" width="17" height="11" style={{ fill: patternFill(row.key, directionOf(row.value)) }} />
          </svg>
          <span className="rest__label">
            <CauseIcon cause={row.key} size={18} />
            {row.label}
          </span>
          <span className={`num num--${row.value >= 0 ? 'hot' : 'cool'}`}>{formatDegSigned(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** What reviews report for the measure, with the link to check it. */
export function Evidence({ evidence }: { evidence: EvidenceData }) {
  return (
    <p className="evidence">
      {capitalize(evidence.finding)}.{' '}
      <a className="text-link" href={evidence.url} target="_blank" rel="noopener">
        {evidence.cite}&nbsp;↗
      </a>
    </p>
  );
}

function AdviceBlock({ advice, expanded }: { advice: Advice; expanded: boolean }) {
  if (advice.kind === 'none') {
    return (
      <div className="advice">
        <p className="advice__reason">
          <Phrase spans={advice.text} />
        </p>
      </div>
    );
  }
  return (
    <div className="advice">
      <p className="advice__title">{advice.title}</p>
      {expanded && (
        <ul className="advice__actions">
          {advice.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      )}
      <p className="advice__reason">
        <Phrase spans={advice.reason} />
      </p>
      <Evidence evidence={advice.evidence} />
    </div>
  );
}

export function Panel({ model, content, header, footer, expanded = false }: PanelProps) {
  const { stats } = model.detail;
  const scale = Math.max(BAR_SCALE_MIN, Math.abs(content.cause?.value ?? 0) * 1.15);
  return (
    <div className="panel">
      <div className="panel__header">{header}</div>
      <h1 className={content.isCity ? 'visually-hidden' : 'panel__title'}>{content.title}</h1>
      <p className="panel__answer">
        <Phrase spans={content.answer} />
      </p>

      <div className="figure">
        <p className="figure__row">
          <span className="figure__value">{formatDeg(content.figure)}</span>
          <span className="figure__caption">{content.figureCaption}</span>
        </p>
        <Ramp levels={model.levels} shares={model.shares} min={stats.lstMin} max={stats.lstMax} value={content.figure} meanMark={content.meanMark} />
      </div>

      {content.cause && <CauseBar row={content.cause} scale={scale} />}
      {content.rest &&
        (expanded ? (
          <div className="rest">
            <p className="rest__summary">{content.rest.summary}</p>
            <RestRows rows={content.rest.rows} />
          </div>
        ) : (
          <details className="rest">
            <summary className="rest__summary">{content.rest.summary}</summary>
            <RestRows rows={content.rest.rows} />
          </details>
        ))}

      <AdviceBlock advice={content.advice} expanded={expanded} />
      {footer}
    </div>
  );
}
