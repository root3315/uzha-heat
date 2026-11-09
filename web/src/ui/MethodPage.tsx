import { MethodContent } from './MethodContent';

export function MethodPage() {
  return (
    <main className="page">
      <p className="eyebrow">Метод и данные</p>
      <h1 className="page__title">Как мы раскладываем жару на причины</h1>
      <p className="page__lead">
        Все данные открытые. Ниже — откуда берутся числа на карте и где их стоит читать с осторожностью.
      </p>
      <MethodContent />
    </main>
  );
}
