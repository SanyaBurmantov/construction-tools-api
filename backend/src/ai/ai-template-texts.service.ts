import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CATEGORY_BASE_RULES,
  PRODUCT_BASE_RULES,
  PRODUCT_TEMPLATES,
  TemplateTexts,
} from './ai-templates';

const KEY_PREFIX = 'ai.text.';
const MAX_TEXT = 8000;

/** One editable text: the shop rules for products / categories, or a kind's guide. */
export type TemplateTextId =
  | 'product-rules'
  | 'category-rules'
  | `kind:${string}`;

/**
 * The texts the AI tasks send, editable from /admin/ai («Шаблоны и
 * проверки») without a deploy. Each is a `SiteSetting` row over the code
 * default in `ai-templates.ts`; no row (or a reset) means the default.
 * A task snapshots its instruction when it is created (`AiTask.promptText`),
 * so an edit applies to the next task, never to one already running.
 */
@Injectable()
export class AiTemplateTextsService {
  constructor(private readonly prisma: PrismaService) {}

  private defaultOf(id: TemplateTextId): string | null {
    if (id === 'product-rules') return PRODUCT_BASE_RULES;
    if (id === 'category-rules') return CATEGORY_BASE_RULES;
    const key = id.slice('kind:'.length);
    return (
      PRODUCT_TEMPLATES.find((template) => template.key === key)?.guide ?? null
    );
  }

  private async stored(): Promise<Map<string, string>> {
    const rows = await this.prisma.siteSetting.findMany({
      where: { key: { startsWith: KEY_PREFIX } },
    });
    return new Map(
      rows.map((row) => [row.key.slice(KEY_PREFIX.length), row.value]),
    );
  }

  /** What a task built now would use. */
  async effective(): Promise<TemplateTexts> {
    const stored = await this.stored();
    const guides: Record<string, string> = {};
    for (const [id, text] of stored) {
      if (id.startsWith('kind:')) guides[id.slice('kind:'.length)] = text;
    }
    return {
      productRules: stored.get('product-rules'),
      categoryRules: stored.get('category-rules'),
      guides,
    };
  }

  /** Every text with its default and whether it was edited. */
  async list() {
    const stored = await this.stored();
    const entry = (id: TemplateTextId) => {
      const value = stored.get(id);
      const fallback = this.defaultOf(id) ?? '';
      return {
        id,
        text: value ?? fallback,
        default: fallback,
        edited: value !== undefined,
      };
    };
    return {
      productRules: entry('product-rules'),
      categoryRules: entry('category-rules'),
      guides: Object.fromEntries(
        PRODUCT_TEMPLATES.map((template) => [
          template.key,
          entry(`kind:${template.key}`),
        ]),
      ),
    };
  }

  /** Saves a text; empty, `null` or the default itself goes back to the default. */
  async set(id: string, text: string | null | undefined) {
    const fallback = this.defaultOf(id as TemplateTextId);
    if (fallback === null)
      throw new BadRequestException(`Неизвестный текст: ${id}`);
    const value = text?.replace(/\r\n/g, '\n').trim() ?? '';
    if (value.length > MAX_TEXT) {
      throw new BadRequestException(`Не длиннее ${MAX_TEXT} символов`);
    }
    if (!value || value === fallback.trim()) {
      await this.prisma.siteSetting.deleteMany({
        where: { key: KEY_PREFIX + id },
      });
    } else {
      await this.prisma.siteSetting.upsert({
        where: { key: KEY_PREFIX + id },
        create: { key: KEY_PREFIX + id, value },
        update: { value },
      });
    }
    return this.list();
  }
}
