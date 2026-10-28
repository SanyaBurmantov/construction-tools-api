import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LeadKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../notifications/telegram.service';
import { MailService } from '../notifications/mail.service';
import { normalizeUnp } from '../common/utils/requisites';
import { attributionColumns } from '../attribution/traffic-source';
import type { AttributionDto } from '../attribution/attribution.dto';
import {
  AdminLeadQueryDto,
  AdminUpdateLeadDto,
  QuestionDto,
} from './dto/b2b.dto';
import {
  buildLeadMail,
  buildLeadTelegram,
  type LeadNotice,
} from './lead-messages';

/** A person asks a handful of questions a day; a script asks hundreds. */
const MAX_LEADS_PER_IP_PER_DAY = 20;

export type LeadInput = {
  kind: LeadKind;
  userId?: string | null;
  companyName?: string | null;
  taxId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  productId?: string | null;
  productName?: string | null;
  productSlug?: string | null;
  items?: LeadNotice['items'] & object;
  total?: number | null;
  currency?: string | null;
  attribution?: AttributionDto;
  ip?: string;
};

const text = (value?: string | null) => value?.trim() || null;

/** Everything but `ipHash` — a rate-limit key, nothing an admin needs. */
const LEAD_SELECT = {
  id: true,
  number: true,
  kind: true,
  status: true,
  companyName: true,
  taxId: true,
  contactName: true,
  phone: true,
  email: true,
  message: true,
  productId: true,
  productName: true,
  productSlug: true,
  items: true,
  total: true,
  currency: true,
  trafficSource: true,
  firstTrafficSource: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, login: true } },
} satisfies Prisma.LeadSelect;

/**
 * Leads: requests that are not orders yet — a downloaded quote, «уточнить
 * наличие», the contact form for organisations. Each one reaches the orders
 * topic in Telegram and the shop mailbox, and waits in /admin/leads.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private mail: MailService,
  ) {}

  /** Same salted hash as reviews: enough to count repeats, not to recover. */
  private hashIp(ip?: string): string | null {
    if (!ip) return null;
    const salt = process.env.REVIEW_IP_SALT || process.env.ADMIN_TOKEN || '';
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
  }

  private async assertBudget(ipHash: string | null) {
    if (!ipHash) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.prisma.lead.count({
      where: { ipHash, createdAt: { gte: since } },
    });
    if (count >= MAX_LEADS_PER_IP_PER_DAY) {
      throw new HttpException(
        'Слишком много заявок с вашего адреса. Позвоните нам — ответим сразу.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Records a lead and tells the managers. Notification never throws. */
  async record(input: LeadInput) {
    const ipHash = this.hashIp(input.ip);
    await this.assertBudget(ipHash);
    const lead = await this.prisma.lead.create({
      data: {
        kind: input.kind,
        userId: input.userId ?? null,
        companyName: text(input.companyName),
        taxId: input.taxId?.trim() ? normalizeUnp(input.taxId) : null,
        contactName: text(input.contactName),
        phone: text(input.phone),
        email: text(input.email)?.toLowerCase() ?? null,
        message: text(input.message),
        productId: input.productId ?? null,
        productName: input.productName ?? null,
        productSlug: input.productSlug ?? null,
        items: (input.items ?? undefined) as Prisma.InputJsonValue | undefined,
        total: input.total ?? null,
        currency: input.currency ?? null,
        ...attributionColumns(input.attribution),
        ipHash,
      },
    });
    this.notify(lead as unknown as LeadNotice);
    return lead;
  }

  private notify(lead: LeadNotice) {
    const origin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, '');
    Promise.resolve()
      .then(() =>
        this.telegram.notifyLead(
          buildLeadTelegram(lead, origin),
          `lead #${lead.number}`,
        ),
      )
      .catch((error) =>
        this.logger.error(`Lead #${lead.number} telegram: ${String(error)}`),
      );
    Promise.resolve()
      .then(() =>
        this.mail.sendToAdmins(
          buildLeadMail(lead, origin),
          `lead #${lead.number}`,
        ),
      )
      .catch((error) =>
        this.logger.error(`Lead #${lead.number} mail: ${String(error)}`),
      );
  }

  /**
   * «Уточнить наличие / подобрать аналог» and the form for organisations.
   * The honeypot answers like a success: a bot learns nothing.
   */
  async createQuestion(dto: QuestionDto, userId?: string, ip?: string) {
    if (dto.website?.trim()) return { ok: true };
    const product = dto.productId
      ? await this.prisma.product.findUnique({
          where: { id: dto.productId },
          select: { id: true, name: true, slug: true },
        })
      : null;
    await this.record({
      kind: LeadKind.QUESTION,
      userId,
      companyName: dto.companyName,
      taxId: dto.taxId,
      contactName: dto.contactName,
      phone: dto.phone,
      email: dto.email,
      message: dto.message,
      attribution: dto.attribution,
      productId: product?.id,
      productName: product?.name,
      productSlug: product?.slug,
      ip,
    });
    return { ok: true };
  }

  async list(query: AdminLeadQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LeadWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;
    const search = query.search?.trim();
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      where.OR = [
        { companyName: contains },
        { contactName: contains },
        { phone: contains },
        { email: contains },
        { taxId: { contains: search.replace(/\s/g, '') } },
        { productName: contains },
        { trafficSource: contains },
      ];
    }
    const [data, total, newCount] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: LEAD_SELECT,
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: { status: 'NEW' } }),
    ]);
    return {
      data,
      newCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async updateStatus(id: string, dto: AdminUpdateLeadDto) {
    const exists = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Заявка не найдена');
    return this.prisma.lead.update({
      where: { id },
      data: { status: dto.status },
      select: LEAD_SELECT,
    });
  }
}
