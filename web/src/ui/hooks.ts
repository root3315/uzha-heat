import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type AsyncState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (error: unknown) => !cancelled && setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, deps);
  return state;
}

/** Width of an element in CSS px, kept current with a ResizeObserver; for SVG drawn at true size. */
export function useWidth<T extends Element>(fallback: number): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width) || fallback);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

/** Window size in CSS px, updated on resize. */
export function useViewport(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize((old) => {
        const next = read();
        return old.width === next.width && old.height === next.height ? old : next;
      }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
}

/** True once the element has come near the viewport; stays true. For lazy maps and charts. */
export function useNear<T extends Element>(margin = '400px'): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: margin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, margin]);
  return [ref, near];
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll an in-page target into view, instantly when the reader asked for less motion. */
export function scrollToId(id: string, instant = false): void {
  document.getElementById(id)?.scrollIntoView({ behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
