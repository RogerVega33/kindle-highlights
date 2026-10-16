/** Shorten only the initial display title; keep the imported source for identity. */
export function importedDisplayTitle(originalTitle: string): string {
  const title = originalTitle.split(/[:(]/, 1)[0].trim();
  return title || originalTitle;
}
