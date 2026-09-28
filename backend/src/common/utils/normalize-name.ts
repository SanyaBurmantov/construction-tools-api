export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9а-я]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
