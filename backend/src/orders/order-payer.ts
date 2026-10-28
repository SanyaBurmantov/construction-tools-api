import { BadRequestException } from '@nestjs/common';
import { CustomerType, PaymentMethod } from '@prisma/client';
import {
  normalizeAccount,
  normalizeBic,
  normalizeUnp,
} from '../common/utils/requisites';

/** The payer fields of `POST /orders`, as typed at checkout. */
export type PayerInput = {
  paymentMethod: PaymentMethod;
  payerName?: string;
  payerTaxId?: string;
  payerAddress?: string;
  payerAccount?: string;
  payerBankName?: string;
  payerBankBic?: string;
};

/** The ordering account's requisites, when the order came from one. */
export type PayerAccount = {
  customerType: CustomerType;
  companyName: string | null;
  taxId: string | null;
  legalAddress: string | null;
  bankAccount: string | null;
  bankName: string | null;
  bankBic: string | null;
};

export type OrderPayer = {
  payerType: CustomerType | null;
  payerName: string | null;
  payerTaxId: string | null;
  payerAddress: string | null;
  payerAccount: string | null;
  payerBankName: string | null;
  payerBankBic: string | null;
};

const NO_PAYER: OrderPayer = {
  payerType: null,
  payerName: null,
  payerTaxId: null,
  payerAddress: null,
  payerAccount: null,
  payerBankName: null,
  payerBankBic: null,
};

const text = (value: string | null | undefined) => value?.trim() || null;

/**
 * Who the invoice is made out to, frozen into the order.
 *
 * What was typed at checkout wins field by field; a company account fills in
 * whatever the form left out (an older client, or a field not shown), so an
 * order from a company always carries its requisites even if the profile
 * changes later. A private buyer's order carries none. Paying by invoice
 * without an organisation and its УНП is refused: there is nobody to bill.
 * Pure — tested without a database.
 */
export function resolvePayer(
  dto: PayerInput,
  account?: PayerAccount | null,
): OrderPayer {
  const company =
    account?.customerType === CustomerType.COMPANY ? account : null;
  const name = text(dto.payerName) ?? text(company?.companyName);

  if (!name) {
    if (dto.paymentMethod === PaymentMethod.INVOICE) {
      throw new BadRequestException(
        'Для оплаты по счёту укажите организацию и её УНП',
      );
    }
    return NO_PAYER;
  }

  const pick = (typed?: string, stored?: string | null) =>
    text(typed) ?? text(stored);
  const taxId = pick(dto.payerTaxId, company?.taxId);
  if (!taxId && dto.paymentMethod === PaymentMethod.INVOICE) {
    throw new BadRequestException(
      'Для оплаты по счёту укажите УНП организации',
    );
  }
  const iban = pick(dto.payerAccount, company?.bankAccount);
  const bic = pick(dto.payerBankBic, company?.bankBic);

  return {
    payerType: CustomerType.COMPANY,
    payerName: name,
    payerTaxId: taxId ? normalizeUnp(taxId) : null,
    payerAddress: pick(dto.payerAddress, company?.legalAddress),
    payerAccount: iban ? normalizeAccount(iban) : null,
    payerBankName: pick(dto.payerBankName, company?.bankName),
    payerBankBic: bic ? normalizeBic(bic) : null,
  };
}
