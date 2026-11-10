import { loadingLine, loadingShare } from '../domain/loading';
import { outlinePath } from '../domain/outlinePath';
import type { LoadStage } from './models';
import type { Route } from './routing';

/** The static first screen from index.html, while it is still up. */
const bootElement = (): HTMLElement | null => document.getElementById('boot');

export const isBooting = (): boolean => bootElement() !== null;

/**
 * Fit the first screen to the address: the map pages open on the map panel, and a city other than
 * the one baked into the page loses the baked outline until its own arrives.
 */
export function prepareBoot(route: Route): void {
  const boot = bootElement();
  if (!boot) return;
  boot.dataset.view = route.view === 'story' ? 'story' : 'tool';
  if (route.cityId && route.cityId !== boot.dataset.city) {
    boot.querySelector('[data-boot-outline] path')?.setAttribute('d', '');
    boot.dataset.city = '';
  }
}

/** Report the loading of the city the page opens on into the first screen. */
export function showBootStage(cityId: string, stage: LoadStage): void {
  const boot = bootElement();
  if (!boot) return;
  if (stage.outline && boot.dataset.city !== cityId) {
    const path = outlinePath(stage.outline);
    boot.querySelector('[data-boot-outline]')?.setAttribute('viewBox', `0 0 ${path.width} ${path.height}`);
    boot.querySelector('[data-boot-outline] path')?.setAttribute('d', path.d);
    boot.dataset.city = cityId;
  }
  const status = boot.querySelector('[data-boot-status]');
  if (status) status.textContent = loadingLine(stage);
  const meter = boot.querySelector<HTMLElement>('[data-boot-meter]');
  const share = loadingShare(stage);
  meter?.parentElement?.classList.toggle('is-open', share === null);
  if (meter) meter.style.transform = share === null ? '' : `scaleX(${share})`;
}

/** The page is ready (or has something to say): the first screen goes. */
export function endBoot(): void {
  bootElement()?.remove();
}
