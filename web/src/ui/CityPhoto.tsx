import { useState } from 'react';
import type { CitySummary } from '../data/contract';

interface CityPhotoProps {
  city: CitySummary;
  className?: string;
}

/** City photo with credit; collapses to a plain tone block if the image is missing or fails. */
export function CityPhoto({ city, className = '' }: CityPhotoProps) {
  const [failed, setFailed] = useState(false);
  const photo = city.photo;
  if (!photo || failed) return <span className={`photo photo--empty ${className}`} aria-hidden />;
  return (
    <figure className={`photo ${className}`}>
      <img src={photo.url} alt={`${city.name}, вид города`} loading="lazy" onError={() => setFailed(true)} />
      <figcaption>{photo.credit}</figcaption>
    </figure>
  );
}
