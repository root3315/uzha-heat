import { texts } from '../i18n/locale';

export const MAP_TEXTS = texts(
  {
    /** The two ends of the section, as the chart and the report name them. */
    ends: ['A', 'B'] as [string, string],
    handle: (letter: string) => `Section end ${letter}`,
    drag: 'drag',
    region: (city: string) => `Surface temperature map: ${city}`,
    basemapFailed: 'Part of the basemap did not load; the isotherms are all here.',
    controls: {
      'NavigationControl.ZoomIn': 'Zoom in',
      'NavigationControl.ZoomOut': 'Zoom out',
      'ScaleControl.Meters': 'm',
      'ScaleControl.Kilometers': 'km',
      'AttributionControl.ToggleAttribution': 'Map sources',
      'CooperativeGesturesHandler.WindowsHelpText': 'To zoom the map, scroll with Ctrl held down',
      'CooperativeGesturesHandler.MacHelpText': 'To zoom the map, scroll with ⌘ held down',
      'CooperativeGesturesHandler.MobileHelpText': 'Move the map with two fingers',
    } as Record<string, string>,
  },
  {
    ends: ['А', 'Б'],
    handle: (letter) => `Конец разреза ${letter}`,
    drag: 'тяните',
    region: (city) => `Карта температуры поверхности: ${city}`,
    basemapFailed: 'Подложка карты загрузилась не вся, изотермы на месте.',
    controls: {
      'NavigationControl.ZoomIn': 'Приблизить',
      'NavigationControl.ZoomOut': 'Отдалить',
      'ScaleControl.Meters': 'м',
      'ScaleControl.Kilometers': 'км',
      'AttributionControl.ToggleAttribution': 'Источники карты',
      'CooperativeGesturesHandler.WindowsHelpText': 'Чтобы приблизить карту, крутите колесо с зажатым Ctrl',
      'CooperativeGesturesHandler.MacHelpText': 'Чтобы приблизить карту, крутите колесо с зажатым ⌘',
      'CooperativeGesturesHandler.MobileHelpText': 'Двигайте карту двумя пальцами',
    },
  },
);

export type MapTexts = (typeof MAP_TEXTS)['en'];
