export const MIN_LOGIN_LENGTH = 3;
export const MAX_LOGIN_LENGTH = 64;

/** Latin letters, digits and the punctuation an e-mail address needs. */
const ALLOWED_LOGIN = /^[a-z0-9._+@-]+$/;

/**
 * Logins are stored normalized, so "Admin", "admin " and "ADMIN" are one
 * account rather than three. Doing it here (and not with a case-insensitive
 * query) keeps the uniqueness guarantee in the database index.
 */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Why a login is unacceptable, or null when it is fine. */
export function loginProblem(login: string): string | null {
  const normalized = normalizeLogin(login);
  if (normalized.length < MIN_LOGIN_LENGTH)
    return `Логин должен быть не короче ${MIN_LOGIN_LENGTH} символов`;
  if (normalized.length > MAX_LOGIN_LENGTH)
    return `Логин не должен быть длиннее ${MAX_LOGIN_LENGTH} символов`;
  if (!ALLOWED_LOGIN.test(normalized))
    return 'Логин может содержать латинские буквы, цифры и символы . _ - + @';
  return null;
}
