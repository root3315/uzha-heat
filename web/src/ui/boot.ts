import { cityName } from '../domain/dataTexts';
import { formats } from '../domain/format';
import { loadingLine, loadingShare } from '../domain/loading';
import { outlinePath } from '../domain/outlinePath';
import type { Locale } from '../i18n/locale';
import { LANDING_TEXTS } from './landing/landing.texts';
import type { LoadStage } from './models';
import type { Route } from './routing';
import { BAR_TEXTS } from './ui.texts';

/** The static first screen from index.html, while it is still up. */
const bootElement = (): HTMLElement | null => document.getElementById('boot');

export const isBooting = (): boolean => bootElement() !== null;

/** The first screen is written in English; put its words into the reader's language, the same words the page will show. */
function translateBoot(boot: HTMLElement, locale: Locale): void {
  const bar = BAR_TEXTS[locale];
  const setText = (selector: string, text: string) => {
    const element = boot.querySelector(selector);
    if (element) element.textContent = text;
  };
  document.documentElement.lang = locale;
  boot.querySelector('.bar__nav')?.setAttribute('aria-label', bar.sectionsLabel);
  boot.querySelectorAll<HTMLElement>('[data-boot-section]').forEach((link) => {
    const id = link.dataset.bootSection as keyof typeof bar.sections | undefined;
    if (id && id in bar.sections) link.textContent = bar.sections[id];
  });
  setText('.bar__lang', bar.switchTo);
  boot.querySelector('.bar__lang')?.setAttribute('lang', locale === 'en' ? 'ru' : 'en');
  setText('.bar__open-long', bar.openMap);
  setText('.bar__open-short', bar.map);
  const name = cityName({ name: boot.dataset.nameRu ?? '', nameEn: boot.dataset.nameEn ?? '' }, locale);
  if (name) setText('.hero__title', LANDING_TEXTS[locale].hero.title(name));
  setText('.boot__figure', `+${formats(locale).formatDeg(0)}`);
  setText('.gauge__label', LANDING_TEXTS[locale].map.gaugeLabel);
  setText('[data-boot-status]', loadingLine({ download: null, building: false }, locale));
}

/**
 * Fit the first screen to the address and the language: the map pages open on the map panel, and a city other than
 * the one baked into the page loses the baked outline until its own arrives.
 */
export function prepareBoot(route: Route, locale: Locale): void {
  const boot = bootElement();
  if (!boot) return;
  translateBoot(boot, locale);
  boot.dataset.view = route.view === 'story' ? 'story' : 'tool';
  if (route.cityId && route.cityId !== boot.dataset.city) {
    boot.querySelector('[data-boot-outline] path')?.setAttribute('d', '');
    boot.dataset.city = '';
  }
}

/** Report the loading of the city the page opens on into the first screen. */
export function showBootStage(cityId: string, stage: LoadStage, locale: Locale): void {
  const boot = bootElement();
  if (!boot) return;
  if (stage.outline && boot.dataset.city !== cityId) {
    const path = outlinePath(stage.outline);
    boot.querySelector('[data-boot-outline]')?.setAttribute('viewBox', `0 0 ${path.width} ${path.height}`);
    boot.querySelector('[data-boot-outline] path')?.setAttribute('d', path.d);
    boot.dataset.city = cityId;
  }
  const status = boot.querySelector('[data-boot-status]');
  if (status) status.textContent = loadingLine(stage, locale);
  const meter = boot.querySelector<HTMLElement>('[data-boot-meter]');
  const share = loadingShare(stage);
  meter?.parentElement?.classList.toggle('is-open', share === null);
  if (meter) meter.style.transform = share === null ? '' : `scaleX(${share})`;
}

/** The page is ready (or has something to say): the first screen goes. */
export function endBoot(): void {
  bootElement()?.remove();
}
