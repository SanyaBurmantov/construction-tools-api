import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeAccount,
  normalizeBic,
  normalizeUnp,
} from '../common/utils/requisites';

/** How VAT is printed on an invoice — the shop's tax status, not a guess. */
export type VatMode = 'NONE' | 'INCLUDED';

/** The shop's own requisites, printed on every invoice and quote. */
export type Seller = {
  name: string;
  unp: string;
  legalAddress: string;
  bankAccount: string;
  bankName: string;
  bankBic: string;
  phone: string;
  email: string;
  /** «Директор Иванов И. И.» — the signature line. */
  signatory: string;
  /** Unset until an admin says which applies; no invoice before that. */
  vatMode: VatMode | null;
  vatRate: number;
  /** How many days an invoice or quote holds its prices. */
  validDays: number;
};

/**
 * Code defaults — the same facts as the storefront's `data/company.ts`. Bank
 * details and the VAT status have no default on purpose: an invoice with a
 * made-up account number or the wrong VAT line is worse than none.
 */
export const SELLER_DEFAULTS: Seller = {
  name: 'ООО «Мультитул»',
  unp: '391807521',
  legalAddress: 'г. Витебск, пр-т Фрунзе, 39а-18',
  bankAccount: '',
  bankName: '',
  bankBic: '',
  phone: '+375 (29) 813-57-97',
  email: 'support@gost.by',
  signatory: '',
  vatMode: null,
  vatRate: 20,
  validDays: 3,
};

const KEY_PREFIX = 'seller.';
const FIELDS = Object.keys(SELLER_DEFAULTS) as (keyof Seller)[];

/** Which fields still keep invoices from being issued, in form order. */
export function missingForInvoice(seller: Seller): (keyof Seller)[] {
  const missing: (keyof Seller)[] = [];
  for (const key of [
    'name',
    'unp',
    'legalAddress',
    'bankAccount',
    'bankName',
    'bankBic',
  ] as const) {
    if (!seller[key].trim()) missing.push(key);
  }
  if (!seller.vatMode) missing.push('vatMode');
  return missing;
}

/**
 * The seller's requisites: `SiteSetting` rows over code defaults, edited in
 * /admin/settings. Read on every document, so a change applies at once —
 * no restart, no deploy.
 */
@Injectable()
export class SellerService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<Seller> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { startsWith: KEY_PREFIX } },
    });
    const stored = new Map(
      rows.map((row) => [row.key.slice(KEY_PREFIX.length), row.value]),
    );
    const seller = { ...SELLER_DEFAULTS };
    for (const key of FIELDS) {
      const value = stored.get(key);
      if (value === undefined) continue;
      if (key === 'vatRate' || key === 'validDays') {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) seller[key] = n;
      } else if (key === 'vatMode') {
        seller.vatMode =
          value === 'NONE' || value === 'INCLUDED' ? value : null;
      } else {
        seller[key] = value;
      }
    }
    return seller;
  }

  /** Whether invoices can be issued right now. */
  async invoiceReady(): Promise<boolean> {
    return missingForInvoice(await this.get()).length === 0;
  }

  async update(patch: Partial<Record<keyof Seller, unknown>>) {
    const writes = FIELDS.filter((key) => patch[key] !== undefined).map(
      (key) => {
        const raw = patch[key];
        let value =
          typeof raw === 'string' || typeof raw === 'number'
            ? String(raw).trim()
            : '';
        if (value && key === 'unp') value = normalizeUnp(value);
        if (value && key === 'bankAccount') value = normalizeAccount(value);
        if (value && key === 'bankBic') value = normalizeBic(value);
        return this.prisma.siteSetting.upsert({
          where: { key: KEY_PREFIX + key },
          create: { key: KEY_PREFIX + key, value },
          update: { value },
        });
      },
    );
    await this.prisma.$transaction(writes);
    const seller = await this.get();
    return { seller, missing: missingForInvoice(seller) };
  }
}
