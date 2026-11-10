import { describe, expect, it } from 'vitest';
import { readWithProgress, type Download } from './load';

function streamed(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body);
}

describe('readWithProgress', () => {
  it('joins the chunks and reports every step against the total', async () => {
    const seen: Download[] = [];
    const bytes = await readWithProgress(streamed(['{"a":', '1}']), 7, (download) => seen.push(download));
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
    expect(seen).toEqual([
      { received: 0, total: 7 },
      { received: 5, total: 7 },
      { received: 7, total: 7 },
    ]);
  });

  it('never reports more received than the total', async () => {
    const seen: Download[] = [];
    await readWithProgress(streamed(['12345']), 3, (download) => seen.push(download));
    expect(seen.at(-1)).toEqual({ received: 5, total: 5 });
  });
});
