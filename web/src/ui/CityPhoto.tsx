import { useState } from 'react';
import type { CitySummary } from '../data/contract';
import { cityName } from '../domain/dataTexts';
import { photoThumb } from '../domain/photo';
import { useLocale } from './locale';
import { MISC_TEXTS } from './ui.texts';

interface CityPhotoProps {
  city: CitySummary;
  className?: string;
  /** The report header is on screen at once and has to be there when printing; cards load as they scroll in. */
  eager?: boolean;
}

/** The city's photo with its credit. Tries the thumbnail, then the original, then quietly shows nothing. */
export function CityPhoto({ city, className = '', eager = false }: CityPhotoProps) {
  const [attempt, setAttempt] = useState(0);
  const locale = useLocale();
  const { photo } = city;
  if (!photo || attempt > 1) return null;
  const src = attempt === 0 ? photoThumb(photo.url) : photo.url;
  return (
    <figure className={`photo ${className}`.trim()}>
      <img
        className="photo__img"
        src={src}
        alt={cityName(city, locale)}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setAttempt((n) => n + 1)}
      />
      <figcaption className="photo__credit">{MISC_TEXTS[locale].photo(photo.credit)}</figcaption>
    </figure>
  );
}
