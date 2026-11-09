import { formatEffect, type Recommendation } from '../../domain/recommendations';
import { formatSigned } from '../../domain/format';

interface RecommendationListProps {
  recommendations: Recommendation[];
}

export function RecommendationList({ recommendations }: RecommendationListProps) {
  if (recommendations.length === 0) {
    return (
      <p className="prose">
        Здесь нет заметных нагревающих факторов, которые можно изменить: участок охлаждают растительность или вода. Его
        стоит сохранить как есть.
      </p>
    );
  }
  return (
    <ol className="recs">
      {recommendations.map((rec) => (
        <li key={rec.id} className="rec">
          <h3 className="rec__title">{rec.title}</h3>
          <p className="rec__why-label">Почему здесь</p>
          <ul className="rec__reasons">
            {rec.reasons.map((reason) => (
              <li key={reason.key}>
                <span>{reason.text}</span>
                <span className="rec__contribution">{formatSigned(reason.contribution, 1)}&nbsp;°C</span>
              </li>
            ))}
          </ul>
          <ul className="rec__actions">
            {rec.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          <p className="rec__effect">
            Ожидаемый эффект: <strong>{formatEffect(rec.effect)}</strong> к температуре поверхности — ориентир по
            опубликованным исследованиям, не прогноз модели.
          </p>
        </li>
      ))}
    </ol>
  );
}
