import { loadCities } from '../data/load';
import { CityPicker } from './CityPicker';
import { CityView } from './CityView';
import { Masthead } from './Masthead';
import { MethodPage } from './MethodPage';
import { StatusMessage } from './StatusMessage';
import { useAsync } from './useAsync';
import { useRoute } from './routing';

export function App() {
  const route = useRoute();
  const cities = useAsync(loadCities, []);

  if (cities.status !== 'ready') {
    return (
      <div className="app">
        <Masthead />
        <StatusMessage state={cities} loadingText="Загружаем список городов" />
      </div>
    );
  }

  const city = route.page === 'city' ? cities.data.find((c) => c.id === route.cityId) : undefined;

  return (
    <div className="app">
      <Masthead city={city} />
      {route.page === 'method' && <MethodPage />}
      {route.page === 'cities' && <CityPicker cities={cities.data} />}
      {route.page === 'city' &&
        (city ? (
          <CityView key={city.id} cityId={city.id} />
        ) : (
          <StatusMessage state={{ status: 'error', message: `Города «${route.cityId}» нет в cities.json.` }} />
        ))}
    </div>
  );
}
