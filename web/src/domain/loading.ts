import type { Locale } from '../i18n/locale';
import { formats } from './format';
import { LOADING_TEXTS } from './small.texts';

export interface LoadProgress {
  /** Bytes of the city file received so far and, when known, in all. Null before the download starts. */
  download: { received: number; total: number | null } | null;
  building: boolean;
}

const MB = 1_000_000;

/** The loading line in figures: what is downloaded of how much, then that the surface is being built. */
export function loadingLine({ download, building }: LoadProgress, locale: Locale): string {
  const t = LOADING_TEXTS[locale];
  if (building) return t.building;
  if (!download) return t.waiting;
  const { formatNumber } = formats(locale);
  const received = formatNumber(download.received / MB, 1);
  return download.total ? t.progress(received, formatNumber(download.total / MB, 1)) : t.received(received);
}

/** Share of the download done, 0 to 1; null while the total is unknown or once the build has started. */
export function loadingShare({ download, building }: LoadProgress): number | null {
  if (building || !download?.total) return null;
  return Math.min(1, download.received / download.total);
}
