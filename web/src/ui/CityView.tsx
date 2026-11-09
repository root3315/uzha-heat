import { useCallback, useMemo, useRef, useState } from 'react';
import type { CityDetail } from '../data/contract';
import { loadCity } from '../data/load';
import { cellProfile, cellsInDistrict, cityFactorMeans, districtProfile, type PlaceProfile, type Selection } from '../domain/places';
import { HeatMap, type HeatMapHandle } from '../map/HeatMap';
import { buildScales, type Granularity, type MapMode } from '../map/mapMode';
import { Report } from '../report/Report';
import { Legend } from './Legend';
import { MapToolbar } from './MapToolbar';
import { CityOverview } from './panel/CityOverview';
import { PlaceDetail } from './panel/PlaceDetail';
import { StatusMessage } from './StatusMessage';
import { useAsync } from './useAsync';

interface CityViewProps {
  cityId: string;
}

export function CityView({ cityId }: CityViewProps) {
  const state = useAsync(() => loadCity(cityId), [cityId]);
  if (state.status !== 'ready') return <StatusMessage state={state} loadingText="Загружаем карту города" />;
  return <CityWorkspace detail={state.data} />;
}

function useSelectedPlace(detail: CityDetail, selection: Selection | null): PlaceProfile | null {
  return useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'cell') return cellProfile(detail, selection.index);
    return districtProfile(detail, selection.index, cellsInDistrict(detail, selection.index));
  }, [detail, selection]);
}

function CityWorkspace({ detail }: { detail: CityDetail }) {
  const mapRef = useRef<HeatMapHandle>(null);
  const [mode, setMode] = useState<MapMode>({ kind: 'lst' });
  const [granularity, setGranularity] = useState<Granularity>('cells');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reportImage, setReportImage] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const scales = useMemo(() => buildScales(detail), [detail]);
  const cityMeans = useMemo(() => cityFactorMeans(detail), [detail]);
  const place = useSelectedPlace(detail, selection);

  const changeGranularity = useCallback((next: Granularity) => {
    setGranularity(next);
    setSelection(null);
  }, []);

  const openReport = () => {
    setReportImage(mapRef.current?.snapshot() ?? null);
    setReportOpen(true);
  };

  return (
    <main className="workspace">
      <div className="workspace__map">
        <HeatMap
          ref={mapRef}
          detail={detail}
          scales={scales}
          mode={mode}
          granularity={granularity}
          selection={selection}
          onSelect={setSelection}
        />
        <MapToolbar
          features={detail.features}
          mode={mode}
          onModeChange={setMode}
          granularity={granularity}
          onGranularityChange={changeGranularity}
          hasDistricts={detail.districts.length > 0}
        />
        <Legend detail={detail} scales={scales} mode={mode} granularity={granularity} />
      </div>

      <aside className="panel" aria-label="Пояснения к карте">
        <div className="panel__actions">
          <button type="button" className="button" onClick={openReport}>
            Отчёт для печати
          </button>
        </div>
        {place ? (
          <PlaceDetail
            detail={detail}
            place={place}
            cityMeans={cityMeans}
            onBack={() => setSelection(null)}
          />
        ) : (
          <CityOverview
            detail={detail}
            mode={mode}
            scales={scales}
            onShowFactor={(key) => setMode({ kind: 'shap', key })}
            onSelectDistrict={(index) => setSelection({ kind: 'district', index })}
          />
        )}
      </aside>

      {reportOpen && (
        <Report detail={detail} mapImage={reportImage} place={place} cityMeans={cityMeans} onClose={() => setReportOpen(false)} />
      )}
    </main>
  );
}
