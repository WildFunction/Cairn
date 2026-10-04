/** Punctuation, spacing and case differ between a file's metadata and the store's. */
export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
