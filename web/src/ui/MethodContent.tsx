const SOURCES: { name: string; use: string }[] = [
  { name: 'Landsat 8/9, Collection 2 Level-2', use: 'температура поверхности (LST), медиана безоблачных летних снимков' },
  { name: 'Sentinel-2 L2A', use: 'индекс растительности NDVI и альбедо поверхности (Liang, 2001)' },
  { name: 'ESA WorldCover 2021', use: 'доли деревьев, застройки, открытого грунта и воды в ячейке' },
  { name: 'Copernicus DEM GLO-30', use: 'высота над уровнем моря' },
  { name: 'OpenStreetMap', use: 'плотность дорог и зданий, каналы и водоёмы' },
];

interface MethodContentProps {
  headingLevel?: 'h2' | 'h3';
}

export function MethodContent({ headingLevel: H = 'h2' }: MethodContentProps) {
  return (
    <div className="method">
      <section>
        <H className="section__title">Данные</H>
        <dl className="method__sources">
          {SOURCES.map((source) => (
            <div key={source.name}>
              <dt>{source.name}</dt>
              <dd>{source.use}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <H className="section__title">Метод</H>
        <ol className="method__steps">
          <li>Город разбит на сетку 200 × 200 м; для каждой ячейки собраны температура поверхности и девять факторов.</li>
          <li>Модель градиентного бустинга XGBoost учится предсказывать температуру ячейки по её факторам.</li>
          <li>
            Точность проверена пространственной кросс-валидацией: город режется на блоки, и модель оценивается на блоках,
            которых не видела. Так соседние ячейки не завышают качество.
          </li>
          <li>
            Значения SHAP раскладывают предсказание для каждой ячейки на вклады факторов в °C: от средней оценки по городу до
            температуры конкретного места.
          </li>
          <li>Рекомендации подбираются по факторам с положительным вкладом и объясняются значениями этого места.</li>
        </ol>
      </section>

      <section>
        <H className="section__title">Ограничения</H>
        <ul className="method__limits">
          <li>Это температура поверхности, а не воздуха: днём она выше и меняется резче.</li>
          <li>Снимок Landsat — около 11:00 по местному времени; вечерний и ночной перегрев не виден.</li>
          <li>SHAP показывает связь в данных, а не доказанную причину; факторы связаны между собой.</li>
          <li>Ожидаемый эффект мер — ориентир по литературе, а не прогноз модели для конкретного участка.</li>
          <li>Слой WorldCover — за 2021 год; новая застройка после него не учтена.</li>
        </ul>
      </section>
    </div>
  );
}
