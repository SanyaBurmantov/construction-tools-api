import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  verifyPassword,
} from './password.util';

describe('password hashing', () => {
  it('verifies the password it hashed', async () => {
    const stored = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse batter', stored)).resolves.toBe(
      false,
    );
  });

  it('salts each hash, so the same password stores differently', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ]);
    expect(a).not.toEqual(b);
    await expect(verifyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password', b)).resolves.toBe(true);
  });

  it('keeps the parameters in the stored string', async () => {
    const stored = await hashPassword('whatever-password');
    expect(stored.split('$')[0]).toBe('scrypt');
    expect(stored.split('$')).toHaveLength(7);
  });

  // A corrupted or foreign hash must be a failed login, not a 500.
  it.each([
    ['empty', ''],
    ['not our format', 'bcrypt$2b$10$abcdef'],
    ['truncated', 'scrypt$16384$8$1'],
    ['non-numeric cost', 'scrypt$x$8$1$32$c2FsdA==$aGFzaA=='],
    ['length mismatch', 'scrypt$16384$8$1$32$c2FsdA==$aGFzaA=='],
  ])('returns false for a %s hash', async (_label, stored) => {
    await expect(verifyPassword('any-password', stored)).resolves.toBe(false);
  });

  it('accepts unicode passwords', async () => {
    const stored = await hashPassword('пароль-пароль');
    await expect(verifyPassword('пароль-пароль', stored)).resolves.toBe(true);
  });
});

describe('passwordProblem', () => {
  it('rejects a short password', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toContain(
      String(MIN_PASSWORD_LENGTH),
    );
  });

  it('accepts a long enough password', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('rejects an absurdly long password', () => {
    expect(passwordProblem('a'.repeat(1000))).not.toBeNull();
  });
});
