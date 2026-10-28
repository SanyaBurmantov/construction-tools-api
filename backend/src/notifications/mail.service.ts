import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { TelegramService } from './telegram.service';
import { servesHttp } from '../common/utils/process-role';

/** A slow mail server must not hold a request or a cron for long. */
const SMTP_TIMEOUT_MS = 15000;
/** One Telegram alert per hour at most while mail stays broken. */
const ALERT_INTERVAL_MS = 60 * 60 * 1000;

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
  private lastAlertAt = 0;

  // Optional so the pure helpers and the tests can build it bare.
  constructor(@Optional() private readonly telegram?: TelegramService) {}

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
      // "Enabled" only meant the variables were set: a wrong password stayed
      // invisible until somebody noticed letters were missing. Log in once at
      // boot so a broken mailbox is reported within a minute of a deploy.
      // Not awaited — the API must not wait on a mail server to start. The API
      // is the process that sends mail; the worker checking too would only
      // double the alert.
      if (!servesHttp()) return;
      void this.verify().then((problem) => {
        if (problem)
          this.reportFailure(`SMTP login failed at startup: ${problem}`);
        else this.logger.log('SMTP login verified');
      });
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

  /**
   * Connects and logs in without sending anything. Resolves null when the
   * server accepted the credentials, otherwise the server's reason.
   */
  async verify(): Promise<string | null> {
    if (!this.enabled) return 'SMTP is not configured';
    try {
      await this.transport().verify();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Logs a mail failure and tells the alerts topic, at most once an hour. */
  private reportFailure(message: string) {
    this.logger.error(message);
    const now = Date.now();
    if (!this.telegram || now - this.lastAlertAt < ALERT_INTERVAL_MS) return;
    this.lastAlertAt = now;
    void this.telegram
      .notifyMailProblem(`${this.user} @ ${this.host}`, message)
      .catch(() => undefined);
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
      this.reportFailure(
        `Mail send failed${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
