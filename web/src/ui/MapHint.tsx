import { useState } from 'react';

const KEY = 'uzha.tool-hint-seen';

function seen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** One line over the map the first time the tool opens, until it is closed. */
export function MapHint({ touch }: { touch: boolean }) {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: the hint shows again next time */
    }
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
