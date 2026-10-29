import type { ChatMessage } from './ai-fields';

/**
 * The second opinion: a separate, cheap request that reads the rewritten
 * name and short description next to the product data and says whether they
 * are true to it. `ai-validate.ts` catches what code can — a number or a
 * brand-like word that is not in the data; this catches what it cannot: «по
 * металлу» on a concrete bit, a mis-read supplier abbreviation, the wrong
 * purpose. Only these two fields: they are what the catalogue and search
 * show, and checking a 3-paragraph description would double the bill.
 */
export const VERIFIED_FIELDS = ['name', 'descriptionShort'] as const;

export type VerifyInput = {
  id: string;
  /** What the rewrite model saw. */
  data: Record<string, unknown>;
  /** The proposed texts, only the fields in VERIFIED_FIELDS. */
  proposed: Record<string, string>;
};

export function buildVerifyMessages(items: VerifyInput[]): ChatMessage[] {
  const system = [
    'Ты проверяющий редактор каталога строительного инструмента.',
    'Для каждого товара даны исходные данные поставщика (data) и новые тексты (proposed).',
    'Проверь каждое поле proposed: всё ли в нём правда по data.',
    'Ошибка — это: другой материал, назначение или тип товара, чем в data; неверно понятое сокращение;',
    'пропущенное или искажённое важное отличие (размер, количество в упаковке, комплектация);',
    'утверждение, которого нет в data. Стиль, порядок слов и полнота — не ошибка.',
    'Если сомневаешься, считай поле верным: отклоняй только явные ошибки.',
    '',
    'Отвечай ТОЛЬКО JSON: {"items":[{"id":"<id>","fields":{"<поле>":"ok" | "<ошибка, одно предложение>"}}]}',
    'Один элемент на каждый id, по одному ключу на каждое поле из proposed.',
  ].join('\n');
  const user = `Товары:\n${JSON.stringify({ items })}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Field → problem, per id, from the verifier's answer. Anything that is not a
 * plain "ok" with some text is a problem; a missing verdict is *not* one — an
 * unreadable answer must not throw away a batch the code checks passed.
 */
export function parseVerifyAnswer(
  records: Map<string, Record<string, unknown>>,
): Map<string, Record<string, string>> {
  const result = new Map<string, Record<string, string>>();
  for (const [id, record] of records) {
    const fields = record.fields;
    if (!fields || typeof fields !== 'object') continue;
    const problems: Record<string, string> = {};
    for (const [field, verdict] of Object.entries(
      fields as Record<string, unknown>,
    )) {
      if (typeof verdict !== 'string') continue;
      const text = verdict.trim();
      if (!text || /^ok\.?$/i.test(text) || /^(верно|ок)\.?$/i.test(text))
        continue;
      problems[field] = text.slice(0, 300);
    }
    if (Object.keys(problems).length) result.set(id, problems);
  }
  return result;
}
