import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/** A slow mail server must not hold a request or a cron for long. */
const SMTP_TIMEOUT_MS = 15000;

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

/** Escapes text for the HTML part of a letter. */
export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `a@x.by, b@x.by` → `['a@x.by', 'b@x.by']`. */
export function parseAddressList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * Outgoing mail over SMTP (the hosting mailbox — hoster.by for gost.by).
 *
 * Disabled unless SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all set, so the
 * app runs unchanged without them. Like `TelegramService`, sending never
 * throws: every caller (a committed order, a created account) has already
 * succeeded by the time a letter goes out, and a mail outage must not turn
 * that into an error.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  private get host() {
    return process.env.SMTP_HOST?.trim() || '';
  }

  private get user() {
    return process.env.SMTP_USER?.trim() || '';
  }

  private get password() {
    return process.env.SMTP_PASSWORD || '';
  }

  get enabled() {
    return Boolean(this.host && this.user && this.password);
  }

  /** `MAIL_FROM` may carry a display name; the mailbox itself is the default. */
  get from() {
    return process.env.MAIL_FROM?.trim() || this.user;
  }

  /** Where order letters go (`MAIL_ADMIN_TO`, comma-separated). */
  get adminRecipients(): string[] {
    return parseAddressList(process.env.MAIL_ADMIN_TO);
  }

  onModuleInit() {
    if (this.enabled) {
      this.logger.log(`SMTP mail enabled via ${this.host} as ${this.user}`);
    } else {
      this.logger.warn(
        'SMTP mail disabled — set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to enable',
      );
    }
  }

  private transport(): Transporter {
    if (this.transporter) return this.transporter;
    const port = Number(process.env.SMTP_PORT) || 465;
    // 465 is implicit TLS; 587/25 start plain and upgrade with STARTTLS.
    const secure = process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;
    this.transporter = createTransport({
      host: this.host,
      port,
      secure,
      auth: { user: this.user, pass: this.password },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
    return this.transporter;
  }

  /** A letter to the shop itself (`MAIL_ADMIN_TO`); false when none is set. */
  async sendToAdmins(
    message: Omit<MailMessage, 'to'>,
    context?: string,
  ): Promise<boolean> {
    const to = this.adminRecipients;
    if (!this.enabled || !to.length) return false;
    return this.send({ ...message, to }, context);
  }

  /** Resolves true when the server accepted the letter. Never throws. */
  async send(message: MailMessage, context?: string): Promise<boolean> {
    if (!this.enabled) return false;
    const label = context ? ` (${context})` : '';
    try {
      await this.transport().sendMail({ from: this.from, ...message });
      return true;
    } catch (error) {
      this.logger.error(
        `Mail send failed${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
