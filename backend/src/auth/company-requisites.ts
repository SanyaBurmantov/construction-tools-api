import {
  normalizeAccount,
  normalizeBic,
  normalizeUnp,
} from '../common/utils/requisites';

/** What an invoice needs about the buyer besides its name. */
export type RequisitesInput = {
  taxId?: string | null;
  legalAddress?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  bankBic?: string | null;
};

type RequisitesData = Record<keyof RequisitesInput, string | null | undefined>;

/**
 * `undefined` → no change, `''`/`null` → cleared, anything else stored in its
 * canonical form (`391 807 521` → `391807521`), so an order and a search by
 * УНП compare like with like. Shared by register, the profile and the admin.
 */
export function requisitesData(dto: RequisitesInput): RequisitesData {
  const field = (
    value: string | null | undefined,
    normalize: (value: string) => string = (v) => v.trim(),
  ) =>
    value === undefined ? undefined : value?.trim() ? normalize(value) : null;
  return {
    taxId: field(dto.taxId, normalizeUnp),
    legalAddress: field(dto.legalAddress),
    bankAccount: field(dto.bankAccount, normalizeAccount),
    bankName: field(dto.bankName),
    bankBic: field(dto.bankBic, normalizeBic),
  };
}
