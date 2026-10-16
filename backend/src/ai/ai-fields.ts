import {
  sanitizeSupplierText,
  sanitizeSupplierTitle,
} from '../parser/supplier-text';
import { AiEntity } from '@prisma/client';

/**
 * What an AI task may rewrite, and the pure prompt/answer plumbing around it.
 * No DB and no HTTP here, so it is unit-tested directly.
 *
 * Only text fields. Prices belong to `PricingService`, identity (slug, sku,
 * barcode, category, brand) to the parsers — a model hallucinating either is
 * far more expensive than a clumsy sentence.
 */
export type AiFieldDef = {
  key: string;
  label: string;
  /** Hard cap; longer answers are cut at a word boundary. */
  maxLength: number;
  /** Told to the model next to the field name. */
  hint: string;
};

export const AI_FIELDS: Record<AiEntity, AiFieldDef[]> = {
  PRODUCT: [
    {
      key: 'name',
      label: 'Название',
      maxLength: 200,
      hint: 'название товара для витрины',
    },
    {
      key: 'descriptionShort',
      label: 'Краткое описание',
      maxLength: 500,
      hint: '1–2 предложения',
    },
    {
      key: 'descriptionFull',
      label: 'Полное описание',
      maxLength: 6000,
      hint: 'простой текст, абзацы через перевод строки, без HTML и Markdown',
    },
    {
      key: 'seoTitle',
      label: 'SEO title',
      maxLength: 120,
      hint: 'до 70 символов',
    },
    {
      key: 'seoDescription',
      label: 'SEO description',
      maxLength: 320,
      hint: 'до 160 символов',
    },
  ],
  CATEGORY: [
    {
      key: 'name',
      label: 'Название',
      maxLength: 120,
      hint: 'название категории для меню',
    },
    {
      key: 'description',
      label: 'Описание',
      maxLength: 4000,
      hint: 'простой текст, без HTML и Markdown',
    },
    {
      key: 'seoTitle',
      label: 'SEO title',
      maxLength: 120,
      hint: 'до 70 символов',
    },
    {
      key: 'seoDescription',
      label: 'SEO description',
      maxLength: 320,
      hint: 'до 160 символов',
    },
  ],
};

export function fieldDefs(entity: AiEntity, keys: string[]): AiFieldDef[] {
  return AI_FIELDS[entity].filter((field) => keys.includes(field.key));
}

export function isKnownField(entity: AiEntity, key: string) {
  return AI_FIELDS[entity].some((field) => field.key === key);
}

export type ChatMessage = { role: 'system' | 'user'; content: string };

/**
 * One request covers a batch of entities: the free tier is counted in
 * requests per day, so five products per call is five times the throughput.
 */
export function buildMessages(params: {
  entity: AiEntity;
  fields: AiFieldDef[];
  instruction: string;
  contexts: Array<Record<string, unknown> & { id: string }>;
}): ChatMessage[] {
  const what = params.entity === 'PRODUCT' ? 'товаров' : 'категорий';
  const fieldList = params.fields
    .map((field) => `- "${field.key}" (${field.label}): ${field.hint}`)
    .join('\n');
  const example: Record<string, string> = { id: '<id из входных данных>' };
  for (const field of params.fields) example[field.key] = '...';

  const system = [
    `Ты редактор каталога интернет-магазина строительных инструментов (Беларусь, цены в BYN).`,
    `Тебе дают JSON со списком ${what}. Для каждого верни новые значения полей:`,
    fieldList,
    ``,
    `Правила:`,
    `- Отвечай ТОЛЬКО JSON-объектом вида {"items":[${JSON.stringify(example)}]} — без пояснений и без \`\`\`.`,
    `- Один элемент на каждый входной id, id копируй как есть.`,
    `- Только перечисленные поля. Если поле менять не нужно — верни текущее значение.`,
    `- Пиши по-русски. Не выдумывай характеристики, которых нет во входных данных.`,
    `- Не упоминай поставщиков, их телефоны, адреса и города.`,
  ].join('\n');

  const user = [
    `Задание:`,
    params.instruction.trim(),
    ``,
    `Данные:`,
    JSON.stringify({ items: params.contexts }),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Pulls `{ items: [...] }` out of a model answer. Small free models wrap JSON
 * in ```json fences, prepend a sentence, or return a bare array — all of it
 * seen in practice, all of it accepted.
 */
export function parseAnswer(
  content: string,
): Map<string, Record<string, unknown>> {
  const json = extractJson(content);
  const list: unknown = Array.isArray(json)
    ? json
    : json && typeof json === 'object'
      ? ((json as Record<string, unknown>).items ??
        (json as Record<string, unknown>).data)
      : undefined;

  if (!Array.isArray(list)) {
    throw new Error('В ответе модели нет списка items');
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id === 'string' || typeof id === 'number') {
      byId.set(String(id), record);
    }
  }
  return byId;
}

function extractJson(content: string): unknown {
  const text = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [
    fenced?.[1],
    text,
    sliceBetween(text, '{', '}'),
    sliceBetween(text, '[', ']'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  throw new Error('Модель вернула не JSON');
}

function sliceBetween(text: string, open: string, close: string) {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

/**
 * The value to write for one field, or undefined to leave it alone. Blank and
 * non-string answers never blank a field — "the model said nothing" must not
 * erase a description.
 */
export function cleanValue(
  field: AiFieldDef,
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value
    .replace(/\r\n/g, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (field.key !== 'descriptionFull' && field.key !== 'description') {
    text = text.replace(/\s+/g, ' ');
  }
  // The prompt carries supplier text, and a model happily copies its sales
  // boilerplate — a competitor's phone, «купить в Минске». The parse-side
  // cleaner never sees AI output, and the field is then locked against the
  // re-parse, so the same filter runs here.
  text = (
    field.key === 'seoTitle' || field.key === 'name'
      ? sanitizeSupplierTitle(text)
      : sanitizeSupplierText(text)
  ).trim();
  if (!text) return undefined;
  if (text.length > field.maxLength) {
    const cut = text.slice(0, field.maxLength);
    const space = cut.lastIndexOf(' ');
    text = (space > field.maxLength * 0.6 ? cut.slice(0, space) : cut).trim();
  }
  return text;
}

export type FieldChange = { old: string | null; new: string };

/** Field-by-field diff of an answer against the current row. */
export function diffAnswer(
  fields: AiFieldDef[],
  current: Record<string, unknown>,
  answer: Record<string, unknown>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    const next = cleanValue(field, answer[field.key]);
    if (next === undefined) continue;
    const old = current[field.key];
    const oldText = typeof old === 'string' ? old : null;
    if (oldText === next) continue;
    changes[field.key] = { old: oldText, new: next };
  }
  return changes;
}

export function truncate(value: string | null | undefined, max: number) {
  if (!value) return value ?? null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
