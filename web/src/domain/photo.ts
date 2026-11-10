/** Wikimedia serves fixed thumbnail widths; this one is sharp on a card and on an A4 header. */
export const THUMB_WIDTH = 960;

const COMMONS = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/(commons|[a-z-]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)/;

/**
 * A Wikimedia Commons original as a thumbnail of the given width, so a card does not pull a 10 MB photo.
 * Anything that is not a Commons original is returned as it is, without the tracking query.
 */
export function photoThumb(url: string, width = THUMB_WIDTH): string {
  const match = COMMONS.exec(url);
  if (!match) return url;
  const [, project, a, ab, file] = match;
  return `https://upload.wikimedia.org/wikipedia/${project}/thumb/${a}/${ab}/${file}/${width}px-${file}`;
}
