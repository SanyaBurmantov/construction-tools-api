import { fixHomoglyphs, numbersIn } from '../ai/ai-validate';

/**
 * What identifies a product in a supplier's name: its codes (letters next to
 * digits — «18V-45», «HAAF3530»), the short capital suffixes models are told
 * apart by («GBH 18V-45 C» vs «… CF», «DLM330Z», «XR»), and its numbers
 * (sizes, pack counts). Wording, word order, case and look-alike letters do
 * not count.
 */
function identity(name: string) {
  const text = fixHomoglyphs(name);
  const codes = (text.match(/[A-Za-z0-9][A-Za-z0-9\-./]*/g) ?? [])
    .filter(
      (token) =>
        /[A-Za-z]/.test(token) &&
        (/\d/.test(token) || /^[A-Za-z]{1,4}$/.test(token)),
    )
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return { codes: new Set(codes), numbers: numbersIn(text) };
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/**
 * Whether a supplier renamed a product in a way that may make it a different
 * product (a new article, another size or pack) rather than reworded it.
 * Only matters while our name is locked: then the storefront keeps our old
 * name, and an admin should look.
 */
export function supplierIdentityChanged(previous: string, next: string) {
  if (!previous.trim() || !next.trim()) return false;
  const before = identity(previous);
  const after = identity(next);
  return (
    !sameSet(before.codes, after.codes) ||
    !sameSet(before.numbers, after.numbers)
  );
}
