/** A sentence with some spans marked as hot or cool numbers. */
export type Tone = 'hot' | 'cool';
export type Span = string | { text: string; tone: Tone };
export type Phrase = Span[];

export const hot = (text: string): Span => ({ text, tone: 'hot' });
export const cool = (text: string): Span => ({ text, tone: 'cool' });

export const plainText = (phrase: Phrase): string => phrase.map((span) => (typeof span === 'string' ? span : span.text)).join('');

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
