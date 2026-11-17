import { useEffect, useState } from 'react';

const KEY = 'uzha.tool-hint-seen';

function seen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    /* private mode: the hint shows again next time */
  }
}

/** One line over the map the first time the tool opens, until it is closed or the map is first tapped (a scroll across the map does not count). */
export function MapHint({ touch }: { touch: boolean }) {
  const [open, setOpen] = useState(() => !seen());
  useEffect(() => {
    if (!open) return undefined;
    const onTap = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.maplibregl-canvas')) return;
      setOpen(false);
      remember();
    };
    document.addEventListener('click', onTap);
    return () => document.removeEventListener('click', onTap);
  }, [open]);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    remember();
  };
  return (
    <p className="map-hint">
      <span>
        Нажмите на&nbsp;участок, чтобы узнать причину · тяните А и&nbsp;Б, чтобы сделать разрез
        {touch ? '' : ' · или ведите по карте с зажатым Shift'}
      </span>
      <button type="button" className="map-hint__close" onClick={close} aria-label="Скрыть подсказку">
        ×
      </button>
    </p>
  );
}
