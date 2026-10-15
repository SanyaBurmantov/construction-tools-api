import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  EmailVerificationService,
  buildVerificationMail,
} from './email-verification.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailService } from '../notifications/mail.service';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function build(row: unknown = null) {
  const created: Array<{ data: Record<string, unknown> }> = [];
  const userUpdate = jest.fn((args: unknown) => args);
  const prisma = {
    emailVerification: {
      deleteMany: jest.fn((args: unknown) => args),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args);
        return args;
      }),
      findUnique: jest.fn(() => Promise.resolve(row)),
    },
    user: { update: userUpdate, findUnique: jest.fn() },
    $transaction: jest.fn(() => Promise.resolve([])),
  } as unknown as PrismaService;
  const send = jest.fn(() => Promise.resolve(true));
  const mail = { enabled: true, send } as unknown as MailService;
  return {
    service: new EmailVerificationService(prisma, mail),
    created,
    send,
    userUpdate,
  };
}

describe('EmailVerificationService', () => {
  const originalOrigin = process.env.PUBLIC_ORIGIN;
  beforeEach(() => {
    process.env.PUBLIC_ORIGIN = 'https://gost.by/';
  });
  afterAll(() => {
    process.env.PUBLIC_ORIGIN = originalOrigin;
  });

  it('stores only the hash and mails the link carrying the token', async () => {
    const { service, created, send } = build();
    await expect(
      service.issue({ id: 'u1', name: 'Иван' }, 'ivan@mail.by'),
    ).resolves.toBe(true);

    const [letter] = send.mock.calls[0] as unknown as [
      { to: string; text: string; subject: string },
    ];
    expect(letter.to).toBe('ivan@mail.by');
    expect(letter.subject).toBe('Подтверждение регистрации на gost.by');
    const token = /verify-email\?token=([\w-]+)/.exec(letter.text)?.[1] ?? '';
    expect(token).toBeTruthy();
    expect(created[0].data.tokenHash).toBe(hash(token));
    expect(created[0].data.email).toBe('ivan@mail.by');
  });

  it('confirms a live link for the address it was sent to', async () => {
    const { service } = build({
      userId: 'u1',
      email: 'ivan@mail.by',
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', email: 'ivan@mail.by' },
    });
    await expect(service.confirm('tok')).resolves.toEqual({
      ok: true,
      email: 'ivan@mail.by',
    });
  });

  it('refuses an expired link', async () => {
    const { service } = build({
      userId: 'u1',
      email: 'ivan@mail.by',
      expiresAt: new Date(Date.now() - 1),
      user: { id: 'u1', email: 'ivan@mail.by' },
    });
    await expect(service.confirm('tok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // The account's e-mail changed after the letter went out.
  it('refuses a link sent to a previous address', async () => {
    const { service } = build({
      userId: 'u1',
      email: 'old@mail.by',
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u1', email: 'new@mail.by' },
    });
    await expect(service.confirm('tok')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('escapes the name in the HTML letter', () => {
    const letter = buildVerificationMail({
      link: 'https://gost.by/verify-email?token=a',
      siteName: 'gost.by',
      name: '<script>',
      ttlHours: 48,
    });
    expect(letter.html).not.toContain('<script>');
    expect(letter.text).toContain('https://gost.by/verify-email?token=a');
  });
});
