import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { sectionAnswer, sourcesLine } from '../domain/answers';
import type { CityModel } from '../domain/cityModel';
import { formatKm } from '../domain/format';
import type { Profile } from '../domain/transect';
import { Panel } from '../ui/panel/Panel';
import type { PanelContent } from '../ui/panelContent';
import { Phrase } from '../ui/Phrase';
import { ProfileChart } from '../ui/ProfileChart';

interface ReportProps {
  model: CityModel;
  content: PanelContent;
  profile: Profile;
  mapImage: string | null;
  placeTitle: string | null;
  onClose(): void;
}

/** Printable width of an A4 sheet at the report's margins, px. */
const SHEET_W = 694;
const PROFILE_H = 200;

const today = () => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

/** The same sheet as the screen, on paper: the answer, the map as it was, the section and the measure. */
export function Report({ model, content, profile, mapImage, placeTitle, onClose }: ReportProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { detail } = model;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('is-reporting');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('is-reporting');
    };
  }, []);

  const meta = `${detail.city.name}${placeTitle ? `, ${placeTitle}` : ''}. Отчёт от ${today()}`;

  return createPortal(
    <div className="report" role="dialog" aria-modal="true" aria-label={`Отчёт: ${detail.city.name}`}>
      <div className="report__bar no-print">
        <button type="button" className="text-button" onClick={() => window.print()}>
          Распечатать или сохранить в PDF
        </button>
        <button type="button" className="text-button" ref={closeRef} onClick={onClose}>
          Закрыть
        </button>
      </div>

      <article className="report__sheet">
        <Panel model={model} content={content} header={<p className="report__meta">{meta}</p>} expanded />

        {mapImage && (
          <figure className="report__map">
            <img src={mapImage} alt={`Изотермы поверхности: ${detail.city.name}, линия разреза от А до Б`} />
          </figure>
        )}

        <section className="report__section">
          <p className="section__answer">
            <Phrase spans={sectionAnswer(profile, detail.stats.lstMean, detail.features)} /> Разрез от А до Б, {formatKm(profile.length)}.
          </p>
          <ProfileChart profile={profile} levels={model.levels} cityMean={detail.stats.lstMean} features={detail.features} width={SHEET_W} height={PROFILE_H} />
        </section>

        <p className="panel__sources">{sourcesLine(detail)} Карта: © OpenStreetMap, OpenFreeMap.</p>
      </article>
    </div>,
    document.body,
  );
}
