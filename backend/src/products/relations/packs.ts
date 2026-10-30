/**
 * One item sold in several packs — «Анкер забиваемый М10х12х40 мм (4 шт в
 * зип-локе) STARFIX» and «… (100 шт в карт. уп.) STARFIX». Only a parenthesis
 * that is nothing but a pack counts: «(7.26кг, L:180-770мм)» on a magnet is a
 * load rating, and a name without a size of its own («Chipboard screw (1000шт)»)
 * may hide different sizes behind one text.
 */
export type Pack = {
  /** The name without its pack, normalised — equal for the whole family. */
  base: string;
  /** The name up to the pack — what the SQL prefilter starts with. */
  prefix: string;
  quantity: number;
  unit: 'шт' | 'кг';
};

const PACK =
  /\(\s*(?:к-т|компл\.?|упак\.?|уп\.?)?\s*(\d+(?:[.,]\d+)?)\s*(шт|кг)(?![а-яё])[^()\d]*\)/iu;

export function parsePack(name: string): Pack | null {
  const match = PACK.exec(name);
  if (!match) return null;
  const quantity = Number(match[1].replace(',', '.'));
  if (!(quantity > 0)) return null;
  const rest = `${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`;
  const base = rest
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
  if (!/\d/.test(base)) return null;
  return {
    base,
    prefix: name.slice(0, match.index),
    quantity,
    unit: match[2].toLowerCase() as Pack['unit'],
  };
}

export type PackOption = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  quantity: number;
  unit: Pack['unit'];
  priceValue: number;
  priceCurrency: string | null;
  unitPrice: number;
  stockStatus: string | null;
  current: boolean;
};

/**
 * The family's packs, one per size (the cheapest when two listings share a
 * size), ordered by size. Fewer than two priced packs: nothing to compare.
 */
export function packOptions(
  current: { id: string; name: string },
  candidates: Array<{
    id: string;
    slug: string;
    name: string;
    priceValue: number | null;
    priceCurrency: string | null;
    stockStatus: string | null;
    image?: string | null;
  }>,
): PackOption[] {
  const own = parsePack(current.name);
  if (!own) return [];
  const bySize = new Map<number, PackOption>();
  for (const candidate of candidates) {
    const pack = parsePack(candidate.name);
    if (
      !pack ||
      pack.base !== own.base ||
      pack.unit !== own.unit ||
      !candidate.priceValue ||
      candidate.priceValue <= 0
    )
      continue;
    const option: PackOption = {
      id: candidate.id,
      slug: candidate.slug,
      name: candidate.name,
      image: candidate.image ?? null,
      quantity: pack.quantity,
      unit: pack.unit,
      priceValue: candidate.priceValue,
      priceCurrency: candidate.priceCurrency,
      unitPrice:
        Math.round((candidate.priceValue / pack.quantity) * 10000) / 10000,
      stockStatus: candidate.stockStatus,
      current: candidate.id === current.id,
    };
    const existing = bySize.get(pack.quantity);
    if (
      !existing ||
      option.current ||
      (!existing.current && option.priceValue < existing.priceValue)
    )
      bySize.set(pack.quantity, option);
  }
  const options = [...bySize.values()].sort((a, b) => a.quantity - b.quantity);
  return options.length > 1 && options.some((option) => option.current)
    ? options
    : [];
}
