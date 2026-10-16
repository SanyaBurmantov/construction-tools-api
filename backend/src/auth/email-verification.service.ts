import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashOpaqueToken } from './token-hash';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, escapeHtml } from '../notifications/mail.service';

const DEFAULT_TTL_HOURS = 48;

/** Same scheme as session tokens — one definition in `token-hash.ts`. */
const hashToken = hashOpaqueToken;

/** The confirmation letter. Pure, so it is tested without SMTP. */
export function buildVerificationMail(input: {
  link: string;
  siteName: string;
  name?: string | null;
  ttlHours: number;
}) {
  // The name is user-supplied: capped so the letter cannot carry a paragraph
  // of someone's spam to an address they typed in.
  const name = input.name?.trim().slice(0, 40);
  const greeting = name ? `Здравствуйте, ${name}!` : 'Здравствуйте!';
  const text = [
    greeting,
    '',
    `Вы зарегистрировались на сайте ${input.siteName}. Чтобы подтвердить e-mail, перейдите по ссылке:`,
    input.link,
    '',
    `Ссылка действует ${input.ttlHours} ч. Если вы не регистрировались — просто проигнорируйте это письмо.`,
  ].join('\n');
  const link = escapeHtml(input.link);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<p>${escapeHtml(greeting)}</p>
<p>Вы зарегистрировались на сайте ${escapeHtml(input.siteName)}. Чтобы подтвердить e-mail, нажмите кнопку:</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#e8590c;color:#fff;text-decoration:none;border-radius:6px">Подтвердить e-mail</a></p>
<p style="color:#666">Или скопируйте ссылку в браузер:<br>${link}</p>
<p style="color:#666">Ссылка действует ${input.ttlHours} ч. Если вы не регистрировались — просто проигнорируйте это письмо.</p>
</div>`;
  return {
    subject: `Подтверждение регистрации на ${input.siteName}`,
    text,
    html,
  };
}

/**
 * E-mail confirmation for storefront accounts.
 *
 * Soft on purpose: an unconfirmed account can still sign in and order — a
 * letter stuck in spam must not cost the shop a sale. What a confirmation
 * gives is `User.emailVerifiedAt`, i.e. proof that the address on file is the
 * customer's. Tokens are stored as SHA-256 like sessions, and each one is bound
 * to the address it was sent to, so changing the e-mail voids old links.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  private ttlHours(): number {
    const hours = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS);
    return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
  }

  private origin(): string {
    return (process.env.PUBLIC_ORIGIN || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
  }

  /**
   * Mints a fresh link (voiding earlier ones) and mails it. Resolves false
   * when no letter went out — mail disabled or the server refused. Never
   * throws: callers have already created or updated the account.
   */
  async issue(
    user: { id: string; name?: string | null },
    email: string,
  ): Promise<boolean> {
    if (!this.mail.enabled) return false;
    try {
      const token = randomBytes(32).toString('base64url');
      const ttlHours = this.ttlHours();
      await this.prisma.$transaction([
        this.prisma.emailVerification.deleteMany({
          where: { userId: user.id },
        }),
        this.prisma.emailVerification.create({
          data: {
            userId: user.id,
            email,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
          },
        }),
      ]);
      const origin = this.origin();
      const letter = buildVerificationMail({
        link: `${origin}/verify-email?token=${token}`,
        siteName: new URL(origin).host,
        name: user.name,
        ttlHours,
      });
      return await this.mail.send(
        { to: email, ...letter },
        `verify ${user.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Could not issue an e-mail confirmation for ${user.id}: ${String(error)}`,
      );
      return false;
    }
  }

  /** Follows the link from the letter. */
  async confirm(token: string) {
    const invalid = new BadRequestException(
      'Ссылка недействительна или устарела — запросите новое письмо в личном кабинете',
    );
    if (!token) throw invalid;
    const row = await this.prisma.emailVerification.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) throw invalid;
    // The account's address changed after the letter was sent.
    if (row.user.email !== row.email) throw invalid;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerification.deleteMany({
        where: { userId: row.userId },
      }),
    ]);
    return { ok: true, email: row.email };
  }

  /** «Отправить письмо ещё раз» from the account page. */
  async resend(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    });
    if (!user?.email)
      throw new BadRequestException('Укажите e-mail в настройках профиля');
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (!this.mail.enabled)
      throw new BadRequestException('Отправка писем на сайте не настроена');
    const sent = await this.issue(user, user.email);
    if (!sent)
      throw new BadRequestException(
        'Не удалось отправить письмо, попробуйте позже',
      );
    return { ok: true, alreadyVerified: false };
  }

  /** Removes expired links; called by the nightly session cleanup. */
  async purgeExpired() {
    const { count } = await this.prisma.emailVerification.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (count) this.logger.log(`Removed ${count} expired e-mail link(s)`);
    return count;
  }
}
