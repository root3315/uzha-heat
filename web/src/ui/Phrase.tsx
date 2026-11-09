import type { Phrase as PhraseSpans } from '../domain/answers';

/** A sentence whose temperature figures are set in the warm or cool ink. */
export function Phrase({ spans }: { spans: PhraseSpans }) {
  return (
    <>
      {spans.map((span, i) =>
        typeof span === 'string' ? (
          span
        ) : (
          <span key={i} className={`num num--${span.tone}`}>
            {span.text}
          </span>
        ),
      )}
    </>
  );
}
