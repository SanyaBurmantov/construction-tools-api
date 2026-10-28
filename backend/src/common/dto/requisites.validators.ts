import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isValidAccount, isValidBic, isValidUnp } from '../utils/requisites';

/**
 * `''` passes: on an update it is how a field is cleared (create DTOs turn it
 * into `undefined` first, see `emptyToUndefined`).
 */
function requisite(
  name: string,
  check: (value: string) => boolean,
  message: string,
  options?: ValidationOptions,
) {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && (value === '' || check(value)),
        defaultMessage: () => message,
      },
    },
    options,
  );
}

export const IsUnp = (options?: ValidationOptions) =>
  requisite(
    'isUnp',
    isValidUnp,
    'УНП — 9 цифр; проверьте номер, контрольная цифра не сходится',
    options,
  );

export const IsBankAccount = (options?: ValidationOptions) =>
  requisite(
    'isBankAccount',
    isValidAccount,
    'Расчётный счёт — 28 символов в формате BY00XXXX0000…; проверьте номер',
    options,
  );

export const IsBic = (options?: ValidationOptions) =>
  requisite(
    'isBic',
    isValidBic,
    'БИК банка — 8 или 11 символов, например AKBBBY2X',
    options,
  );
