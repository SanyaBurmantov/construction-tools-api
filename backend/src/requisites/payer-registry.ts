/**
 * The tax ministry's public payer registry (МНС, «Государственный реестр
 * плательщиков»): `GET https://grp.nalog.gov.by/api/grp-public/data?unp=…&type=json`.
 * It covers organisations *and* sole proprietors (ИП), which is why it is used
 * instead of the Ministry of Justice's ЕГР API.
 *
 * Answers seen on 2026-11-06:
 *   200 {"row":{"vunp":"391807521","vnaimp":"Общество с ограниченной
 *        ответственностью \"МультиТул\"","vnaimk":"ООО \"МультиТул\"",
 *        "vpadres":"Республика Беларусь, …","dreg":"2016-05-03",
 *        "ckodsost":"1","vkods":"Действующий","dlikv":null,…}}
 *   400 {"status":400,"message":"Нет данных по запросу",…}  — unknown УНП
 *
 * Pure: turns an HTTP status + body into a verdict, tested without network.
 */

export type PayerRecord = {
  unp: string;
  /** Full registered name. */
  name: string;
  /** Short name («ООО "МультиТул"») — what goes on the invoice and the form. */
  shortName: string;
  address: string | null;
  /** Registry state as the registry spells it («Действующий», «Ликвидирован»…). */
  state: string | null;
  /** false once liquidated / excluded — such a payer cannot be billed. */
  active: boolean;
};

export type PayerLookup =
  | { status: 'found'; payer: PayerRecord }
  | { status: 'not_found' }
  /** Registry down, slow or answering something unexpected — never blocks a sale. */
  | { status: 'unavailable' };

export const PAYER_REGISTRY_URL =
  'https://grp.nalog.gov.by/api/grp-public/data';

const str = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The registry writes names with straight quotes; the storefront uses «ёлочки». */
export function prettifyQuotes(value: string): string {
  return value.replace(/"([^"]*)"/g, '«$1»');
}

export function parsePayerRegistry(
  httpStatus: number,
  body: unknown,
): PayerLookup {
  if (httpStatus === 400 || httpStatus === 404) {
    const message = str((body as { message?: unknown } | null)?.message);
    // «Нет данных по запросу» is the registry saying "no such payer"; any other
    // 400 (a changed API, a malformed request) is not the customer's fault.
    return message && /нет данных/i.test(message)
      ? { status: 'not_found' }
      : { status: 'unavailable' };
  }
  if (httpStatus !== 200) return { status: 'unavailable' };

  const row = (body as { row?: Record<string, unknown> } | null)?.row;
  const unp = str(row?.vunp);
  const fullName = str(row?.vnaimp);
  const shortName = str(row?.vnaimk) ?? fullName;
  if (!row || !unp || !shortName) return { status: 'unavailable' };

  const state = str(row.vkods);
  const code = str(row.ckodsost);
  const liquidated = Boolean(str(row.dlikv));
  const active =
    !liquidated &&
    (code !== null
      ? code === '1'
      : !/ликвид|исключ|прекращ/i.test(state ?? ''));

  return {
    status: 'found',
    payer: {
      unp,
      name: prettifyQuotes(fullName ?? shortName),
      shortName: prettifyQuotes(shortName),
      address: str(row.vpadres),
      state,
      active,
    },
  };
}

/**
 * Why an order or a registration with this УНП is refused, or null when it
 * may go on. An unavailable registry lets it through: a ministry outage must
 * not stop a company from buying — the manager sees the УНП on the invoice.
 */
export function payerProblem(lookup: PayerLookup): string | null {
  if (lookup.status === 'not_found') {
    return 'УНП не найден в реестре плательщиков МНС — проверьте номер';
  }
  if (lookup.status === 'found' && !lookup.payer.active) {
    return `${lookup.payer.shortName}: ${
      lookup.payer.state?.toLowerCase() || 'не действует'
    } по данным реестра плательщиков — счёт выставить нельзя`;
  }
  return null;
}
