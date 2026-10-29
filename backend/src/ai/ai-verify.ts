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
    'Артикул, код модели или характеристика, взятые из data (sku, model, specs), — не ошибка, даже если их не было в старом названии.',
    'Если сомневаешься, считай поле верным: отклоняй только явные ошибки.',
    '',
    'Отвечай ТОЛЬКО JSON: {"items":[{"id":"<id>","fields":{"<поле>":{"ok":true} или {"ok":false,"problem":"<ошибка, одно предложение>"}}}]}',
    'Один элемент на каждый id, по одному ключу на каждое поле из proposed.',
  ].join('\n');
  const user = `Товары:\n${JSON.stringify({ items })}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Field → problem, per id, from the verifier's answer. A verdict is the
 * object the prompt asks for — `{ ok: false, problem }` is an objection,
 * `{ ok: true }` is not. A model that answers with a bare string instead is
 * read leniently: «ok», «верно» and anything starting with them pass, other
 * text is the problem. A missing or unreadable verdict is *not* an
 * objection — it must not throw away a field the code checks passed.
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
      const problem = objection(verdict);
      if (problem) problems[field] = problem.slice(0, 300);
    }
    if (Object.keys(problems).length) result.set(id, problems);
  }
  return result;
}

function objection(verdict: unknown): string | null {
  if (verdict && typeof verdict === 'object') {
    const { ok, problem } = verdict as { ok?: unknown; problem?: unknown };
    if (ok !== false && ok !== 'false') return null;
    return typeof problem === 'string' && problem.trim()
      ? problem.trim()
      : 'не прошло проверку смысла';
  }
  if (typeof verdict !== 'string') return null;
  const text = verdict.trim();
  if (!text || /^(ok|ок|верно|true)(?![a-zа-яё])/i.test(text)) return null;
  return text;
}
