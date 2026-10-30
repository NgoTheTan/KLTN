/**
 * Unicode-aware text helpers.
 *
 * JavaScript's `\b` only understands ASCII word characters, so patterns such as
 * `/\bphải\b/` silently fail on Vietnamese words ending in a diacritic. These
 * helpers build regexes with Unicode letter lookarounds instead.
 */

const BEFORE = '(?<![\\p{L}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{N}_])';

/** Build a case-insensitive regex matching any of the given words/phrases as whole words. */
export function wordsRegex(words: string[], extraFlags = ''): RegExp {
  const alt = words.map(escapeRegex).join('|');
  return new RegExp(`${BEFORE}(?:${alt})${AFTER}`, `iu${extraFlags}`);
}

/** Count whole-word occurrences of a single word/phrase. */
export function countWord(text: string, word: string): number {
  const re = new RegExp(`${BEFORE}${escapeRegex(word)}${AFTER}`, 'giu');
  return (text.match(re) ?? []).length;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split text into sentences, using Intl.Segmenter when available. */
export function splitSentences(text: string, locale: 'vi' | 'en'): string[] {
  const SegmenterCtor = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  let parts: string[];
  if (SegmenterCtor) {
    parts = [...new SegmenterCtor(locale, { granularity: 'sentence' }).segment(text)].map((s) => s.segment);
  } else {
    parts = text.split(/(?<=[.!?。;])\s+/);
  }
  return parts.map((s) => s.trim()).filter((s) => s.length > 5);
}
