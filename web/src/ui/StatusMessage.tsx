import type { AsyncState } from './useAsync';
import { routeHref } from './routing';

interface StatusMessageProps {
  state: Exclude<AsyncState<unknown>, { status: 'ready' }>;
  loadingText?: string;
}

export function StatusMessage({ state, loadingText = 'Загружаем данные' }: StatusMessageProps) {
  if (state.status === 'loading') {
    return (
      <p className="status" role="status">
        <span className="status__pulse" aria-hidden />
        {loadingText}
      </p>
    );
  }
  return (
    <div className="status status--error" role="alert">
      <p>{state.message}</p>
      <p className="status__hint">
        Проверьте, что в <code>web/public/data/</code> лежат файлы пайплайна или выполните <code>npm run mock</code>.{' '}
        <a href={routeHref({ page: 'cities' })}>К списку городов</a>
      </p>
    </div>
  );
}
