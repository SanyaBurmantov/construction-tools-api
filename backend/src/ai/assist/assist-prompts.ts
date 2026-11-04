import { AiEntity } from '@prisma/client';
import { answerItems, type ChatMessage } from '../ai-fields';
import { validateAnswer } from '../ai-validate';
import { cleanSynonymGroups } from '../../products/search-fts';
import { unitOfKey } from '../../catalog-normalizer/spec-aliases';
import { isIdentitySpec } from '../../parser/spec-filterable';

/**
 * What the assistant's jobs send to the model and how an answer is read.
 * Pure: no DB, no HTTP — every rule about what the model may decide is here
 * and unit-tested. The common rule: the model chooses **among what we give
 * it** (a category from the candidates, products from the search results,
 * keys from the list); anything outside is dropped, not trusted.
 */

const SHOP =
  'Ты сотрудник интернет-магазина инструмента и крепежа gost.by (Беларусь, покупатели — прежде всего организации).';

function messages(system: string[], data: unknown): ChatMessage[] {
  return [
    { role: 'system', content: [SHOP, ...system].join('\n') },
    { role: 'user', content: `Данные:\n${JSON.stringify(data)}` },
  ];
}

const str = (value: unknown, max = 2000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/* ---- 2. Categorize ------------------------------------------------------ */

export type CategorizeItem = {
  id: string;
  name: string;
  brand: string | null;
  specs: string[];
  candidates: Array<{ id: string; path: string }>;
};

export type CategorizeVerdict = {
  categoryId: string | null;
  confident: boolean;
  reason: string;
};

export function buildCategorizeMessages(items: CategorizeItem[]) {
  return messages(
    [
      'Для каждого товара выбери ОДНУ категорию каталога из его списка candidates — ту, где покупатель будет его искать.',
      'Выбирай только из candidates этого товара. Если ни одна не подходит — categoryId: null.',
      'confidence: "high" — если категория точно про этот вид товара; иначе "low".',
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"<id товара>","categoryId":"<id категории или null>","confidence":"high|low","reason":"<коротко, почему>"}]}',
    ],
    { items },
  );
}

export function parseCategorizeAnswer(
  content: string,
  items: CategorizeItem[],
): Map<string, CategorizeVerdict> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out = new Map<string, CategorizeVerdict>();
  for (const record of answerItems(content)) {
    const item = byId.get(str(record.id));
    if (!item) continue;
    const chosen = str(record.categoryId);
    const valid = item.candidates.some((candidate) => candidate.id === chosen);
    out.set(item.id, {
      categoryId: valid ? chosen : null,
      confident: valid && str(record.confidence) === 'high',
      reason: str(record.reason, 300),
    });
  }
  return out;
}

/* ---- 3. Search synonyms ------------------------------------------------- */

export type SynonymTerm = { id: string; term: string; searches: number };

export type SynonymProposal = { term: string; group: string[] };

export function buildSynonymMessages(terms: SynonymTerm[]) {
  return messages(
    [
      'Это поисковые запросы покупателей, по которым поиск по каталогу ничего не нашёл.',
      'Для каждого запроса реши: это другое название (жаргон, сокращение, опечатка, другая форма слова) товара, который бывает в магазине инструмента? Тогда предложи группу синонимов.',
      'Группа — 2–4 ОСНОВЫ слов (начало слова без окончания, 3–20 строчных букв): основа слова из запроса и основы того, как товар называется в каталоге. Пример: «шурик» → ["шурик","шуруповерт"]; «болгарка» → ["болгарк","ушм","углошлифовальн"].',
      'Если запрос — не товар магазина, бессмыслица, бренд или точный артикул — group: null.',
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"<id>","group":["...","..."] или null}]}',
    ],
    { items: terms.map(({ id, term }) => ({ id, term })) },
  );
}

/**
 * Proposals that can work: a clean group (search-fts rules) one of whose
 * stems the term's own word starts with — otherwise the group would never
 * fire for the query it is meant to fix.
 */
export function parseSynonymAnswer(
  content: string,
  terms: SynonymTerm[],
): SynonymProposal[] {
  const byId = new Map(terms.map((term) => [term.id, term]));
  const out: SynonymProposal[] = [];
  for (const record of answerItems(content)) {
    const term = byId.get(str(record.id));
    if (!term || !Array.isArray(record.group)) continue;
    const [group] = cleanSynonymGroups([record.group]);
    if (!group) continue;
    const words = term.term
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/[^\p{L}\p{N}]+/u);
    if (!words.some((word) => group.some((stem) => word.startsWith(stem)))) {
      continue;
    }
    out.push({ term: term.term, group: group.slice(0, 4) });
  }
  return out;
}

/* ---- 4. Lead drafts ----------------------------------------------------- */

export type LeadCandidate = {
  id: string;
  name: string;
  brand: string | null;
  inStock: boolean;
};

export type LeadInputForDraft = {
  message: string | null;
  productName: string | null;
  companyName: string | null;
};

export type LeadDraft = { text: string; productIds: string[] };

export function buildLeadMessages(
  lead: LeadInputForDraft,
  candidates: LeadCandidate[],
) {
  return messages(
    [
      'Покупатель оставил заявку «уточнить наличие / подобрать аналог». Напиши черновик ответа, который менеджер проверит и отправит.',
      'Предлагай только товары из candidates (по id), 1–5 самых подходящих; в наличии — в первую очередь. Если подходящих нет — productIds: [] и в тексте предложи уточнить задачу.',
      'Текст: вежливо, коротко (до 700 символов), по-русски, обращение на «вы». Не называй цены, сроки и наличие — менеджер допишет их сам; не обещай скидок. Названия товаров бери из candidates.',
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"lead","text":"<черновик>","productIds":["<id>",...]}]}',
    ],
    { lead, candidates },
  );
}

export function parseLeadAnswer(
  content: string,
  candidates: LeadCandidate[],
): LeadDraft | null {
  const [record] = answerItems(content);
  if (!record) return null;
  const text = str(record.text, 1500);
  if (text.length < 20) return null;
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const ids = Array.isArray(record.productIds)
    ? [
        ...new Set(
          record.productIds
            .map((id) => str(id))
            .filter((id) => allowed.has(id)),
        ),
      ].slice(0, 5)
    : [];
  return { text, productIds: ids };
}

/* ---- 5. Same characteristic, different names ---------------------------- */

export type SpecGroupInput = {
  key: string;
  name: string;
  unit: string | null;
  products: number;
  samples: string[];
};

export type SpecMergeProposal = {
  keys: string[];
  /** The key that survives: the most used of the group. */
  into: string;
  name: string;
};

export function buildSpecMessages(category: string, specs: SpecGroupInput[]) {
  return messages(
    [
      `Это характеристики товаров раздела «${category}»: ключ, название, единица, сколько товаров, примеры значений.`,
      'Найди группы, где РАЗНЫЕ ключи на деле одна и та же характеристика (одинаковый смысл и одинаковая единица), например «Мощность» и «Потребляемая мощность».',
      'Не объединяй разные величины: «Длина» и «Длина кабеля», «Диаметр» и «Диаметр посадочный», «Вес» и «Вес с упаковкой» — разные.',
      'Для группы дай понятное покупателю название. Если таких групп нет — пустой список.',
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"g1","keys":["<ключ>","<ключ>"],"name":"<название>"}]}',
    ],
    { specs },
  );
}

export function parseSpecAnswer(
  content: string,
  specs: SpecGroupInput[],
): SpecMergeProposal[] {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const used = new Set<string>();
  const out: SpecMergeProposal[] = [];
  for (const record of answerItems(content)) {
    if (!Array.isArray(record.keys)) continue;
    const keys = [
      ...new Set(
        record.keys.map((key) => str(key)).filter((key) => byKey.has(key)),
      ),
    ].filter((key) => !used.has(key));
    if (keys.length < 2) continue;
    // One unit per filter: «Длина, мм» and «Длина, м» stay two.
    if (new Set(keys.map(unitOfKey)).size > 1) continue;
    const members = keys.map((key) => byKey.get(key)!);
    if (members.some((spec) => isIdentitySpec(spec.name))) continue;
    const name = str(record.name, 80) || members[0].name;
    const into = [...members].sort((a, b) => b.products - a.products)[0].key;
    keys.forEach((key) => used.add(key));
    out.push({ keys: keys.sort(), into, name });
  }
  return out;
}

/* ---- 6. Duplicates: a second opinion ------------------------------------ */

export type DuplicateGroupInput = {
  id: string;
  products: Array<{
    id: string;
    name: string;
    brand: string | null;
    sku: string | null;
    model: string | null;
    barcode: string | null;
    specs: string[];
  }>;
};

export type DuplicateVerdict = {
  verdict: 'same' | 'different' | 'unsure';
  reason: string;
};

export function buildDuplicateMessages(groups: DuplicateGroupInput[]) {
  return messages(
    [
      'Каждая группа — карточки, которые программа заподозрила в дубле. Реши: это ОДИН и тот же товар (тот же бренд, модель, размер, комплектация и фасовка) или разные?',
      'Разный размер, фасовка, комплектация (SOLO/SET, с аккумулятором/без), цвет или модификация — это разные товары.',
      'verdict: "same", "different" или "unsure" (данных не хватает). reason — одно предложение: чем отличаются или почему одинаковы.',
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"<id группы>","verdict":"same|different|unsure","reason":"..."}]}',
    ],
    { groups },
  );
}

export function parseDuplicateAnswer(
  content: string,
  groups: DuplicateGroupInput[],
): Map<string, DuplicateVerdict> {
  const ids = new Set(groups.map((group) => group.id));
  const out = new Map<string, DuplicateVerdict>();
  for (const record of answerItems(content)) {
    const id = str(record.id);
    const verdict = str(record.verdict);
    if (!ids.has(id)) continue;
    if (verdict !== 'same' && verdict !== 'different' && verdict !== 'unsure')
      continue;
    out.set(id, { verdict, reason: str(record.reason, 300) });
  }
  return out;
}

/* ---- 7. Category + brand landings --------------------------------------- */

export type LandingInput = {
  id: string;
  brand: string;
  category: string;
  /** The category chain, for context. */
  path: string;
  productCount: number;
  examples: string[];
};

export type LandingTexts = {
  h1: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
};

export type LandingResult = {
  texts: LandingTexts | null;
  /** Field → why the checks refused it; a landing with any is not published. */
  rejected: Record<string, string>;
};

export const LANDING_RULES = [
  'Напиши тексты для страницы каталога «<категория> <бренд>» — товары одного бренда в одной категории.',
  '- h1 — заголовок страницы: категория во множественном числе + бренд («Перфораторы Makita»), до 90 символов, без «купить».',
  '- description — простой текст без HTML и Markdown, 2 абзаца: какие товары бренда есть в этой категории (по примерам из данных), для каких работ и кому подходят. Без чисел и характеристик конкретных товаров.',
  '- seoTitle — до 70 символов: h1 и уточнение («… в каталоге», «… для профессионалов»); без названия сайта и доменов.',
  '- seoDescription — до 160 символов: что на странице, затем обязательно «Доставка по Беларуси, оплата по безналу для организаций».',
  'Не пиши про наличие, цены, скидки, гарантию, страну, «лучший», «официальный дилер»; не упоминай телефоны и сайты. Пиши по-русски, деловым языком.',
];

export function buildLandingMessages(items: LandingInput[]) {
  return messages(
    [
      ...LANDING_RULES,
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"<id>","h1":"...","description":"...","seoTitle":"...","seoDescription":"..."}]}',
    ],
    { items },
  );
}

/** The same checks an AI task runs, against the brand, the category and the example names. */
export function parseLandingAnswer(
  content: string,
  items: LandingInput[],
): Map<string, LandingResult> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out = new Map<string, LandingResult>();
  for (const record of answerItems(content)) {
    const item = byId.get(str(record.id));
    if (!item) continue;
    const texts: LandingTexts = {
      h1: str(record.h1, 200).replace(/\s+/g, ' '),
      description: str(record.description, 4000),
      seoTitle: str(record.seoTitle, 200).replace(/\s+/g, ' '),
      seoDescription: str(record.seoDescription, 400).replace(/\s+/g, ' '),
    };
    const source = [
      item.brand,
      item.category,
      item.path,
      ...item.examples,
    ].join('\n');
    const rejected = validateAnswer(
      { entity: AiEntity.CATEGORY, source, oldName: item.category },
      {
        description: texts.description,
        seoTitle: texts.seoTitle,
        seoDescription: texts.seoDescription,
      },
    );
    const h1 = texts.h1;
    if (h1.length < 5 || h1.length > 90)
      rejected.h1 = `длина заголовка ${h1.length}`;
    else if (!h1.toLowerCase().includes(item.brand.toLowerCase()))
      rejected.h1 = 'в заголовке нет бренда';
    else if (/купить|цен[аы]|минск/i.test(h1))
      rejected.h1 = 'в заголовке продающие слова';
    out.set(item.id, { texts, rejected });
  }
  return out;
}

/* ---- 8. Sizes of one line ----------------------------------------------- */

export type VariantCandidate = { id: string; name: string };

export type VariantProposal = {
  line: string;
  members: Array<{ id: string; label: string }>;
};

export function buildVariantMessages(
  brand: string,
  category: string,
  products: VariantCandidate[],
) {
  return messages(
    [
      `Это товары бренда ${brand} из категории «${category}», которые сайт пока не связал в переключатель размеров.`,
      'Найди группы, где товары — ОДНА модель/линейка, которая отличается ТОЛЬКО размером, длиной, диаметром или фасовкой (как размеры одного сверла).',
      'Не объединяй разные модели, разные материалы, разную комплектацию или разные виды товара.',
      'Для группы: line — общее название линейки без размера; для каждого товара label — его размер коротко, как в названии («6 мм», «М10х40», «1/2"»).',
      'Если групп нет — пустой список.',
      'Отвечай ТОЛЬКО JSON: {"items":[{"id":"g1","line":"...","members":[{"id":"<id товара>","label":"..."}]}]}',
    ],
    { products },
  );
}

const numbersOf = (text: string) =>
  (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

/**
 * Groups that can be applied: two members or more, each product in one group
 * only, labels that differ and whose numbers are all in that product's name
 * (a label is the size the name already says), a line under 80 characters
 * whose numbers every member's name carries.
 */
export function parseVariantAnswer(
  content: string,
  products: VariantCandidate[],
): VariantProposal[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const used = new Set<string>();
  const out: VariantProposal[] = [];
  for (const record of answerItems(content)) {
    const line = str(record.line, 200).replace(/\s+/g, ' ');
    if (line.length < 3 || line.length > 80 || !Array.isArray(record.members))
      continue;
    const members: Array<{ id: string; label: string }> = [];
    for (const raw of record.members) {
      if (!raw || typeof raw !== 'object') continue;
      const id = str((raw as Record<string, unknown>).id);
      const label = str((raw as Record<string, unknown>).label, 60).replace(
        /\s+/g,
        ' ',
      );
      const product = byId.get(id);
      if (!product || used.has(id) || !label || label.length > 40) continue;
      const nameNumbers = new Set(numbersOf(product.name));
      if (!numbersOf(label).every((n) => nameNumbers.has(n))) continue;
      members.push({ id, label });
    }
    const labels = new Set(members.map((member) => member.label.toLowerCase()));
    if (members.length < 2 || labels.size !== members.length) continue;
    const lineNumbers = numbersOf(line);
    if (
      !members.every((member) => {
        const names = new Set(numbersOf(byId.get(member.id)!.name));
        return lineNumbers.every((n) => names.has(n));
      })
    )
      continue;
    members.forEach((member) => used.add(member.id));
    out.push({ line, members });
  }
  return out;
}
