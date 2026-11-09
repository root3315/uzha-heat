import { useEffect, useRef, type MouseEvent } from 'react';
import { formatNumber } from '../domain/format';
import { scrollToId } from './hooks';
import { Link } from './Link';

interface BarProps {
  home: string;
  /** The full map, for the bar's main button. */
  tool: string | null;
  /** On the landing the section links scroll; elsewhere they lead back to it. */
  onLanding: boolean;
  found: number;
  total: number | null;
}

const SECTIONS = [
  ['why', 'Почему жарко'],
  ['cities', 'Города'],
  ['method', 'Как считали'],
  ['team', 'Команда'],
] as const;

/** Fixed bar: the name, the landing's sections, the live counter of the opening game and the way to the map. */
export function Bar({ home, tool, onLanding, found, total }: BarProps) {
  const countRef = useRef<HTMLSpanElement>(null);
  const last = useRef(found);

  useEffect(() => {
    const element = countRef.current;
    const grew = found > last.current;
    last.current = found;
    if (!element || !grew) return;
    element.classList.remove('is-bump');
    void element.offsetWidth;
    element.classList.add('is-bump');
  }, [found]);

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
      {total !== null && (
        <span ref={countRef} className="pill bar__count" aria-live="polite">
          найдено горячих <b>{formatNumber(found, 0)}</b>&nbsp;/ {formatNumber(total, 0)}
        </span>
      )}
      {tool && (
        <Link className="pill pill--ink" href={tool}>
          Открыть карту
        </Link>
      )}
    </header>
  );
}
