import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { OutboxMessage, OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { MailService } from '../notifications/mail.service';
import {
  buildCustomerOrderMail,
  buildOrderMail,
} from '../notifications/order-mail';
import { SellerService } from '../b2b/seller.service';

export const ORDER_NOTIFICATION_KINDS = [
  'order.telegram',
  'order.mail.admins',
  'order.mail.customer',
] as const;
export type OrderNotificationKind = (typeof ORDER_NOTIFICATION_KINDS)[number];

/** Retries before a message is FAILED: ~1 + 5 + 15 + 60 + 180 min ≈ 4.5 h. */
export const OUTBOX_MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MIN = [1, 5, 15, 60, 180];
/** How long a claimed message is ours; a crash mid-send frees it after this. */
const LEASE_MS = 2 * 60 * 1000;
const BATCH = 20;
const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Confirmation letters to one address per 24 h; a buyer places a few at most. */
export const CUSTOMER_MAILS_PER_DAY = 5;

/** What one delivery attempt came to. */
export type DeliveryOutcome = 'sent' | 'skipped' | 'failed';

/**
 * Pure: the row update after an attempt. `attempts` already counts this one
 * (the claim increments it).
 */
export function outboxAfterAttempt(
  outcome: DeliveryOutcome,
  attempts: number,
  now: Date,
  error?: string,
): Prisma.OutboxMessageUpdateInput {
  if (outcome === 'sent')
    return { status: OutboxStatus.SENT, sentAt: now, lockedUntil: null };
  if (outcome === 'skipped')
    return {
      status: OutboxStatus.SKIPPED,
      lockedUntil: null,
      lastError: error ?? null,
    };
  if (attempts >= OUTBOX_MAX_ATTEMPTS)
    return {
      status: OutboxStatus.FAILED,
      lockedUntil: null,
      lastError: error ?? null,
    };
  const delay =
    RETRY_DELAYS_MIN[Math.min(attempts - 1, RETRY_DELAYS_MIN.length - 1)];
  return {
    status: OutboxStatus.PENDING,
    lockedUntil: null,
    nextAttemptAt: new Date(now.getTime() + delay * 60_000),
    lastError: error ?? null,
  };
}

/**
 * Order notifications through the transactional outbox (`OutboxMessage`).
 *
 * `enqueue()` runs inside the order's transaction, so the order and its
 * notifications are committed together or not at all. `deliverForOrder()` is
 * the API's immediate attempt right after the commit (fire-and-forget, never
 * throws — exactly the old behaviour when everything works); `deliverDue()`
 * is the worker's sweep for what that attempt did not send: a crash, an SMTP
 * or Telegram outage, a deploy at the wrong second. A claim with a lease
 * (`FOR UPDATE SKIP LOCKED`) keeps the two from sending one message twice.
 *
 * A message is rebuilt from the DB at send time — the payload is only the
 * order id — so the letter always shows the order as stored.
 */
@Injectable()
export class OrderNotificationsService {
  private readonly logger = new Logger(OrderNotificationsService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly mail: MailService,
    @Optional() private readonly seller?: SellerService,
  ) {}

  /** Inside the order transaction. */
  async enqueue(
    tx: Prisma.TransactionClient,
    order: { id: string; customerEmail: string | null },
  ): Promise<void> {
    const kinds: OrderNotificationKind[] = [
      'order.telegram',
      'order.mail.admins',
    ];
    if (order.customerEmail) kinds.push('order.mail.customer');
    await tx.outboxMessage.createMany({
      data: kinds.map((kind) => ({ kind, payload: { orderId: order.id } })),
    });
  }

  /** The API's attempt right after the commit. Never throws. */
  deliverForOrder(orderId: string): Promise<void> {
    return this.claim(Prisma.sql`"payload"->>'orderId' = ${orderId}`)
      .then((messages) => this.deliverAll(messages))
      .catch((error) => {
        this.logger.error(
          `Order ${orderId}: notifications not sent now, the worker retries: ${String(error)}`,
        );
      });
  }

  /** Worker only (`@Interval` is inert in the API process). */
  @Interval(30_000)
  async deliverDue(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      // Older than a few seconds: the API's own immediate attempt goes first.
      const messages = await this.claim(
        Prisma.sql`"createdAt" < NOW() - INTERVAL '15 seconds'`,
      );
      await this.deliverAll(messages);
    } catch (error) {
      this.logger.error(`Outbox sweep failed: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
  }

  @Cron('35 4 * * *')
  async purge(): Promise<void> {
    const { count } = await this.prisma.outboxMessage.deleteMany({
      where: {
        status: { not: OutboxStatus.PENDING },
        createdAt: { lt: new Date(Date.now() - KEEP_DAYS * DAY_MS) },
      },
    });
    if (count) this.logger.log(`Outbox: purged ${count} old messages`);
  }

  private async claim(where: Prisma.Sql): Promise<OutboxMessage[]> {
    return this.prisma.$queryRaw<OutboxMessage[]>`
      UPDATE "OutboxMessage"
      SET "lockedUntil" = NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
          "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "OutboxMessage"
        WHERE "status" = 'PENDING'
          AND "nextAttemptAt" <= NOW()
          AND ("lockedUntil" IS NULL OR "lockedUntil" < NOW())
          AND ${where}
        ORDER BY "nextAttemptAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
  }

  private async deliverAll(messages: OutboxMessage[]): Promise<void> {
    for (const message of messages) {
      let outcome: DeliveryOutcome;
      let error: string | undefined;
      try {
        [outcome, error] = await this.deliver(message);
      } catch (err) {
        outcome = 'failed';
        error = err instanceof Error ? err.message : String(err);
      }
      const update = outboxAfterAttempt(
        outcome,
        message.attempts,
        new Date(),
        error?.slice(0, 1000),
      );
      await this.prisma.outboxMessage.update({
        where: { id: message.id },
        data: update,
      });
      if (update.status === OutboxStatus.FAILED) {
        this.logger.error(
          `Outbox ${message.kind} for ${JSON.stringify(message.payload)} gave up: ${error}`,
        );
        // Telegram alerting about Telegram is pointless; a mail failure has
        // already been reported by MailService itself (notifyMailProblem).
      }
    }
  }

  private async deliver(
    message: OutboxMessage,
  ): Promise<[DeliveryOutcome, string?]> {
    const orderId = (message.payload as { orderId?: string } | null)?.orderId;
    const order = orderId
      ? await this.prisma.order.findUnique({
          where: { id: orderId },
          include: { items: true },
        })
      : null;
    if (!order) return ['skipped', 'order not found'];
    const publicOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');

    switch (message.kind as OrderNotificationKind) {
      case 'order.telegram':
        if (!this.telegram.enabled) return ['skipped', 'Telegram off'];
        return (await this.telegram.notifyNewOrder(order))
          ? ['sent']
          : ['failed', 'Telegram did not accept the message'];

      case 'order.mail.admins':
        if (!this.mail.enabled) return ['skipped', 'SMTP off'];
        return (await this.mail.sendToAdmins(
          buildOrderMail(order, publicOrigin),
          `order #${order.number}`,
        ))
          ? ['sent']
          : ['failed', 'no admin mailbox accepted the letter'];

      case 'order.mail.customer': {
        if (!this.mail.enabled) return ['skipped', 'SMTP off'];
        const to = order.customerEmail;
        if (!to) return ['skipped', 'no address'];
        // A guest order takes any address, and the letter goes out from our
        // mailbox: without a cap, 10 orders a minute per IP was a way to
        // mail-bomb someone and get gost.by's SMTP listed as spam
        // (audit 2026-10-30). The order itself is unaffected.
        const recent = await this.prisma.order.count({
          where: {
            customerEmail: { equals: to, mode: 'insensitive' },
            createdAt: { gte: new Date(Date.now() - DAY_MS) },
          },
        });
        if (recent > CUSTOMER_MAILS_PER_DAY) {
          return [
            'skipped',
            `${recent} orders to that address in 24 h, no letter`,
          ];
        }
        // A company paying by invoice gets the PDF link straight away —
        // when the seller's requisites are complete.
        const invoiceUrl =
          publicOrigin &&
          order.paymentMethod === 'INVOICE' &&
          order.payerName &&
          (await this.seller?.invoiceReady())
            ? `${publicOrigin}/api/orders/${order.id}/invoice.pdf`
            : undefined;
        // The footer carries the seller's requisites as set in the admin.
        const seller = await this.seller?.get().catch(() => undefined);
        return (await this.mail.send(
          {
            to,
            ...buildCustomerOrderMail(order, publicOrigin, invoiceUrl, seller),
          },
          `order #${order.number} to customer`,
        ))
          ? ['sent']
          : ['failed', 'SMTP did not accept the letter'];
      }

      default:
        return ['skipped', `unknown kind ${message.kind}`];
    }
  }
}
