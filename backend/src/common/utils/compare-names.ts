import { normalizeName } from './normalize-name';

export function compareNames(a: string, b: string) {
  const na = normalizeName(a);
  const nb = normalizeName(b);

  return na === nb;
}
