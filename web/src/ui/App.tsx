import { loadCities } from '../data/load';
import { CityScreen } from './CityScreen';
import { useAsync } from './hooks';
import { PatternDefs } from './patterns';
import { useRoute } from './routing';

/** Opens straight on the map of the first city; the city is switched from the panel. */
export function App() {
  const route = useRoute();
  const cities = useAsync(loadCities, []);

  if (cities.status !== 'ready') {
    return (
      <p className="app-status" role="status">
        {cities.status === 'loading' ? 'Загружаем города' : `Не получилось загрузить список городов: ${cities.message}`}
      </p>
    );
  }
  const city = cities.data.find((c) => c.id === route.cityId) ?? cities.data[0];
  if (!city) return <p className="app-status">В cities.json нет ни одного города.</p>;

  return (
    <>
      <PatternDefs />
      <CityScreen key={city.id} cities={cities.data} city={city} page={route.page} />
    </>
  );
}
