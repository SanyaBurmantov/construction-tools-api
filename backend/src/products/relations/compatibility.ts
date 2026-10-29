import { createHash } from 'node:crypto';

export const COMPATIBILITY_RULE_VERSION = 1;
export const MAX_REFERENCES = 16;
const MAX_TEXT_LENGTH = 12_000;

export type RelationIdentity = {
  id: string;
  name: string;
  categoryId: string;
  brandId: string | null;
  model: string | null;
  sku: string | null;
  descriptionShort: string | null;
  descriptionFull: string | null;
  aiLockedFields: string[];
};

export type RelationBrand = { id: string; name: string };
export type ModelReference = {
  brandId: string;
  code: string;
  field: 'name' | 'descriptionShort' | 'descriptionFull';
};

/** Must match signatureSql(): NULLs and field order are intentional. */
export function compatibilitySignature(product: RelationIdentity): string {
  return createHash('md5')
    .update(
      [
        product.name,
        product.categoryId,
        product.brandId,
        product.model,
        product.sku,
        product.descriptionShort,
        product.descriptionFull,
        product.aiLockedFields.join('\u001e'),
      ]
        .map((value) => value ?? '')
        .join('\u001f'),
    )
    .digest('hex');
}

/** Whole identifiers only; suffixes stay significant (DF333 != DF333D). */
export function modelCode(value: string | null | undefined): string | null {
  if (!value || value.length > 80) return null;
  const text = value.normalize('NFKC').trim().toUpperCase();
  if (/[A-ZА-ЯЁ]*\d+[A-ZА-ЯЁ]*\s*[-–—]\s*[A-ZА-ЯЁ]+\s*\d/u.test(text))
    return null;
  // Slashes, ranges and prose are deliberately unsupported in v1.
  if (!/^[A-ZА-ЯЁ0-9]+(?:[\s‐‑–—_-]+[A-ZА-ЯЁ0-9]+)*$/u.test(text)) return null;
  const code = text.replace(/[\s‐‑–—_-]/gu, '');
  if (
    code.length < 4 ||
    !/[A-ZА-ЯЁ]/u.test(code) ||
    !/\d/u.test(code) ||
    /^\d+(?:V|В|W|ВТ|MM|ММ|AH|АЧ)$/u.test(code)
  )
    return null;
  return code;
}

const ACCESSORY =
  /(?:^|\s)(?:фильтр[а-яё]*|аккумулятор(?:ы|а|ов)?|зарядное|адаптер[а-яё]*|переходник[а-яё]*|насадк[а-яё]*|бур(?:ы|а|ов)?|сверл[а-яё]*|диск(?:и|а|ов)?|цепь|цепи|шин[аы]|патрон[а-яё]*|нож(?:и|а|ей)?|щ[её]тк[а-яё]*|меш[оа]к[а-яё]*|ремен[а-яё]*|ремень|оснастк[а-яё]*)(?=\s|$)/iu;
const TOOL =
  /(?:^|\s)(?:дрель|дрели|шурупов[её]рт[а-яё]*|перфоратор[а-яё]*|пылесос[а-яё]*|шлифмашин[а-яё]*|пил[аы]|станок|станки|лобзик[а-яё]*|триммер[а-яё]*)(?=\s|$)/iu;

export function isAccessory(name: string): boolean {
  const text = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const accessory = ACCESSORY.exec(text);
  const tool = TOOL.exec(text);
  // A tool sold "с аккумулятором" is not itself an accessory.
  return Boolean(accessory && (!tool || accessory.index < tool.index));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Supported: explicit positive clauses with a named brand and complete model
 * list. No brand guessing, model families, ranges or "fits all" inference.
 */
export function extractModelReferences(
  product: Pick<
    RelationIdentity,
    'name' | 'descriptionShort' | 'descriptionFull'
  > &
    Partial<Pick<RelationIdentity, 'aiLockedFields'>>,
  brands: RelationBrand[],
): ModelReference[] {
  if (product.aiLockedFields?.includes('name') || !isAccessory(product.name))
    return [];
  const references = new Map<string, ModelReference>();
  const fields = ['name', 'descriptionShort', 'descriptionFull'] as const;

  // Conflicting positive/negative statements across fields are not resolved
  // by guessing which supplier sentence to believe.
  if (
    fields.some(
      (field) =>
        !product.aiLockedFields?.includes(field) &&
        /не\s+(?:подходит|совместим|для)|несовместим|кроме|исключая|\b(?:except|excluding)\b|not\s+(?:compatible|suitable)/iu.test(
          product[field] ?? '',
        ),
    )
  )
    return [];

  for (const field of fields) {
    if (product.aiLockedFields?.includes(field)) continue;
    const raw = product[field] ?? '';
    const text = raw.slice(0, MAX_TEXT_LENGTH);
    // Sentence/clause boundaries stop brand carry-over into unrelated prose.
    const sentences = text.split(/[.!?;\n\r]/u);
    if (raw.length > MAX_TEXT_LENGTH) sentences.pop();
    for (const sentence of sentences) {
      if (
        /\b(?:not|except|excluding)\b|(?:^|\s)(?:не|кроме|исключая)(?:\s|$)/iu.test(
          sentence,
        )
      )
        continue;
      const marker =
        /(?:^|\s)(?:подходит\s+для|совместим(?:а|о|ы|ый|ая|ое|ые)?\s+с|совместимость\s*[:：]|для\s+модел(?:и|ей))\s*/iu.exec(
          sentence,
        ) ?? (field === 'name' ? /(?:^|\s)для\s+/iu.exec(sentence) : null);
      if (!marker) continue;
      let tail = sentence.slice(marker.index + marker[0].length).trim();
      tail = tail.replace(/^(?:модел(?:и|ей)|инструментов)\s+/iu, '');
      tail = tail.replace(
        /^(?:пылесос(?:а|ов)?|дрел(?:и|ей)|шурупов[её]рт(?:а|ов)?|перфоратор(?:а|ов)?|пил(?:ы)?|триммер(?:а|ов)?)\s+/iu,
        '',
      );
      // A finite list only; prose after a model is not silently discarded.
      const parts = tail.split(/\s*(?:,|\s+и\s+|\s+and\s+)\s*/iu);
      let brand: RelationBrand | undefined;
      const sentenceReferences: ModelReference[] = [];
      let valid = true;
      for (const part of parts.slice(0, MAX_REFERENCES)) {
        let value = part.trim();
        const matches = brands.filter((candidate) =>
          new RegExp(`^${escapeRegex(candidate.name)}\\s+`, 'iu').test(value),
        );
        if (matches.length > 1) {
          valid = false;
          break;
        }
        if (matches.length === 1) {
          brand = matches[0];
          value = value.slice(brand.name.length).trim();
        }
        if (!brand) {
          valid = false;
          break;
        }
        const code = modelCode(value);
        if (!code) {
          valid = false;
          break;
        }
        sentenceReferences.push({
          brandId: brand.id,
          code,
          field,
        });
      }
      if (!valid) continue;
      for (const reference of sentenceReferences) {
        references.set(`${reference.brandId}:${reference.code}`, reference);
        if (references.size >= MAX_REFERENCES) return [...references.values()];
      }
    }
  }
  return [...references.values()];
}

export function matchesReference(
  reference: ModelReference,
  product: Pick<RelationIdentity, 'brandId' | 'model' | 'sku'>,
): boolean {
  return (
    reference.brandId === product.brandId &&
    [product.model, product.sku].some(
      (value) => modelCode(value) === reference.code,
    )
  );
}
