import type { MouseEvent } from 'react';
import { scrollToId } from './hooks';
import { Link } from './Link';
import { useLocale, useSetLocale } from './locale';
import { BAR_TEXTS } from './ui.texts';

interface BarProps {
  home: string;
  /** The full map, for the bar's main button. */
  tool: string | null;
  /** On the landing the section links scroll; elsewhere they lead back to it. */
  onLanding: boolean;
}

const SECTIONS = ['problem', 'why', 'cities', 'method'] as const;

/** EN or RU: the pill names the other language, in that language. */
function LanguageSwitch() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = BAR_TEXTS[locale];
  const other = locale === 'en' ? 'ru' : 'en';
  return (
    <button type="button" className="pill pill--small bar__lang" lang={other} aria-label={t.switchLabel} title={t.switchLabel} onClick={() => setLocale(other)}>
      {t.switchTo}
    </button>
  );
}

/** Fixed bar: the name, the landing's sections (a scrollable row of chips on a phone), the language and the way to the map. */
export function Bar({ home, tool, onLanding }: BarProps) {
  const t = BAR_TEXTS[useLocale()];
  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    scrollToId(id);
  };

  return (
    <header className="bar">
      {onLanding ? (
        <a href="#top" className="bar__id" onClick={jump('top')}>
          UzHa
        </a>
      ) : (
        <Link href={home} className="bar__id">
          UzHa
        </Link>
      )}
      <nav className="bar__nav" aria-label={t.sectionsLabel}>
        {SECTIONS.map((id) =>
          onLanding ? (
            <a key={id} href={`#${id}`} onClick={jump(id)}>
              {t.sections[id]}
            </a>
          ) : (
            <Link key={id} href={`${home}#${id}`}>
              {t.sections[id]}
            </Link>
          ),
        )}
      </nav>
      <LanguageSwitch />
      {tool && (
        <Link className="pill pill--ink bar__open" href={tool}>
          <span className="bar__open-long">{t.openMap}</span>
          <span className="bar__open-short" aria-hidden="true">
            {t.map}
          </span>
        </Link>
      )}
    </header>
  );
}
