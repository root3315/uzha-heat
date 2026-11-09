import type { MouseEvent } from 'react';
import { scrollToId } from './hooks';
import { Link } from './Link';

interface BarProps {
  home: string;
  /** The full map, for the bar's main button. */
  tool: string | null;
  /** On the landing the section links scroll; elsewhere they lead back to it. */
  onLanding: boolean;
}

const SECTIONS = [
  ['problem', 'Проблема'],
  ['why', 'Почему жарко'],
  ['cities', 'Города'],
  ['method', 'Как считали'],
] as const;

/** Fixed bar: the name, the landing's sections (a scrollable row of chips on a phone) and the way to the map. */
export function Bar({ home, tool, onLanding }: BarProps) {
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
      <nav className="bar__nav" aria-label="Разделы">
        {SECTIONS.map(([id, label]) =>
          onLanding ? (
            <a key={id} href={`#${id}`} onClick={jump(id)}>
              {label}
            </a>
          ) : (
            <Link key={id} href={`${home}#${id}`}>
              {label}
            </Link>
          ),
        )}
      </nav>
      {tool && (
        <Link className="pill pill--ink bar__open" href={tool}>
          <span className="bar__open-long">Открыть карту</span>
          <span className="bar__open-short" aria-hidden="true">
            Карта
          </span>
        </Link>
      )}
    </header>
  );
}
