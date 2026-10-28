import { BadRequestException } from '@nestjs/common';
import { resolvePayer, type PayerAccount } from './order-payer';

const companyAccount: PayerAccount = {
  customerType: 'COMPANY',
  companyName: 'ООО «Ромашка»',
  taxId: '391807521',
  legalAddress: 'г. Витебск, ул. Ленина, 1',
  bankAccount: 'BY15AKBB30120000000040000000',
  bankName: 'Беларусбанк',
  bankBic: 'AKBBBY2X',
};

describe('resolvePayer', () => {
  it('takes the requisites from a company account when the form sent none', () => {
    expect(resolvePayer({ paymentMethod: 'INVOICE' }, companyAccount)).toEqual({
      payerType: 'COMPANY',
      payerName: 'ООО «Ромашка»',
      payerTaxId: '391807521',
      payerAddress: 'г. Витебск, ул. Ленина, 1',
      payerAccount: 'BY15AKBB30120000000040000000',
      payerBankName: 'Беларусбанк',
      payerBankBic: 'AKBBBY2X',
    });
  });

  it('lets what was typed at checkout win field by field, normalized', () => {
    const payer = resolvePayer(
      {
        paymentMethod: 'INVOICE',
        payerName: 'ОАО «Другое»',
        payerTaxId: '100 325 912',
        payerAccount: 'by32 alfa 3012 2000 0000 0000 0000',
      },
      companyAccount,
    );
    expect(payer.payerName).toBe('ОАО «Другое»');
    expect(payer.payerTaxId).toBe('100325912');
    expect(payer.payerAccount).toBe('BY32ALFA30122000000000000000');
    // Not typed — still the account's.
    expect(payer.payerBankBic).toBe('AKBBBY2X');
  });

  it('records a guest company that typed its requisites', () => {
    const payer = resolvePayer({
      paymentMethod: 'INVOICE',
      payerName: 'ИП Петров',
      payerTaxId: '391807521',
    });
    expect(payer.payerType).toBe('COMPANY');
    expect(payer.payerAddress).toBeNull();
  });

  it('records no payer for a private buyer', () => {
    const payer = resolvePayer(
      { paymentMethod: 'CASH' },
      { ...companyAccount, customerType: 'INDIVIDUAL', companyName: null },
    );
    expect(payer.payerType).toBeNull();
    expect(payer.payerName).toBeNull();
  });

  it('refuses an invoice with nobody to bill', () => {
    expect(() => resolvePayer({ paymentMethod: 'INVOICE' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      resolvePayer({ paymentMethod: 'INVOICE', payerName: 'ООО «Ромашка»' }),
    ).toThrow(/УНП/);
  });

  it('does not require a УНП when the company pays in cash', () => {
    const payer = resolvePayer({
      paymentMethod: 'CASH',
      payerName: 'ООО «Ромашка»',
    });
    expect(payer.payerName).toBe('ООО «Ромашка»');
    expect(payer.payerTaxId).toBeNull();
  });
});
