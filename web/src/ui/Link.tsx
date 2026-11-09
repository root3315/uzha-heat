import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from './routing';

/** An ordinary link that stays on the page: a new history entry, no reload. Modified clicks behave as usual. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={click} {...rest} />;
}
