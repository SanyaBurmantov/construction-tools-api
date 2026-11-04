/**
 * The AI assistant's jobs: DeepSeek as a worker inside the shop. Each job is
 * a switch and a daily limit an admin sets in «ИИ-тексты → Помощник»; all
 * are **off** until switched on — a paid key must not start spending on a
 * deploy. What each one may do on its own is the line drawn in the module
 * docs (CLAUDE.md, «AI assistant»): it writes only where a mistake is cheap
 * and reversible, and proposes everywhere else.
 */
export const ASSIST_JOBS = [
  'autopilot',
  'categorize',
  'synonyms',
  'leads',
  'specs',
  'duplicates',
  'landings',
  'variants',
] as const;

export type AssistJob = (typeof ASSIST_JOBS)[number];

export type AssistJobSettings = {
  enabled: boolean;
  /** Items per day: products, terms, leads, categories, groups, landings. */
  daily: number;
  /** Autopilot only: the template its tasks use (`preset:<id>` | `prompt:<id>` | ''). */
  template?: string;
  /** Autopilot only: the fields its tasks write. */
  fields?: string[];
};

export type AssistJobInfo = {
  key: AssistJob;
  title: string;
  /** What it does and what it may do on its own — shown next to the switch. */
  description: string;
  /** What `daily` counts. */
  unit: string;
  defaults: AssistJobSettings;
  /** How long a job with nothing to do rests before looking again. */
  idleMinutes: number;
};

export const ASSIST_JOB_INFO: Record<AssistJob, AssistJobInfo> = {
  autopilot: {
    key: 'autopilot',
    title: 'Автопилот текстов новых товаров',
    description:
      'Раз в час берёт опубликованные товары, у которых ИИ ещё не писал тексты (сначала новые и с фото), и ставит обычную ИИ-задачу с правилами магазина и выбранным шаблоном. Задачи видны во вкладке «Задачи» и откатываются.',
    unit: 'товаров в сутки',
    defaults: {
      enabled: false,
      daily: 200,
      template: 'preset:product-full-b2b',
      fields: [
        'descriptionShort',
        'descriptionFull',
        'seoTitle',
        'seoDescription',
      ],
    },
    idleMinutes: 60,
  },
  categorize: {
    key: 'categorize',
    title: 'Разбор «Неразобранных товаров поставщиков»',
    description:
      'Подбирает товарам из скрытой резервной категории настоящую категорию — только из существующих в каталоге. Уверенный выбор применяется сразу (с откатом), сомнительный ждёт решения ниже. Категория закрепляется: перепарсинг её не вернёт.',
    unit: 'товаров в сутки',
    defaults: { enabled: false, daily: 300 },
    idleMinutes: 60,
  },
  synonyms: {
    key: 'synonyms',
    title: 'Синонимы поиска',
    description:
      'Смотрит запросы «ничего не найдено» из журнала поиска и предлагает синонимы («шурик» → «шуруповёрт»). Предложение показывает, сколько товаров найдётся с ним. Включается в поиск только после «Принять».',
    unit: 'запросов в сутки',
    defaults: { enabled: false, daily: 100 },
    idleMinutes: 12 * 60,
  },
  leads: {
    key: 'leads',
    title: 'Черновики ответов на заявки',
    description:
      'Для новой заявки «уточнить наличие / подобрать аналог» подбирает товары из нашего каталога и пишет менеджеру черновик ответа. Ничего не отправляет: черновик виден в «Заявках».',
    unit: 'заявок в сутки',
    defaults: { enabled: false, daily: 50 },
    idleMinutes: 5,
  },
  specs: {
    key: 'specs',
    title: 'Одинаковые характеристики под разными названиями',
    description:
      'По разделам каталога ищет характеристики, которые на деле одно и то же («Мощность» и «Потребляемая мощность, Вт»), чтобы в фильтрах был один пункт. Только с одной единицей измерения; применяется после «Принять».',
    unit: 'разделов в сутки',
    defaults: { enabled: false, daily: 20 },
    idleMinutes: 24 * 60,
  },
  duplicates: {
    key: 'duplicates',
    title: 'Второе мнение по дублям',
    description:
      'Для групп в «Дублях» говорит, один это товар или разные, и почему. Ничего не склеивает — мнение видно рядом с группой.',
    unit: 'групп в сутки',
    defaults: { enabled: false, daily: 100 },
    idleMinutes: 6 * 60,
  },
  landings: {
    key: 'landings',
    title: 'Посадочные «категория + бренд»',
    description:
      'Пишет заголовок, текст и SEO для страниц вида «Перфораторы Makita» — ссылка со страницы бренда на категорию. Прошедшие проверки публикуются сами и попадают в sitemap; их можно скрыть.',
    unit: 'страниц в сутки',
    defaults: { enabled: false, daily: 60 },
    idleMinutes: 6 * 60,
  },
  variants: {
    key: 'variants',
    title: 'Размеры одной линейки',
    description:
      'Находит товары одного бренда и категории, которые правила не связали в переключатель размеров, и предлагает «Линейку» и подписи вариантов. Применяется после «Принять».',
    unit: 'групп в сутки',
    defaults: { enabled: false, daily: 40 },
    idleMinutes: 12 * 60,
  },
};

/** The stored settings over the defaults; unknown or broken values fall back. */
export function mergeJobSettings(
  job: AssistJob,
  raw: unknown,
): AssistJobSettings {
  const defaults = ASSIST_JOB_INFO[job].defaults;
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const daily = Number(value.daily);
  return {
    ...defaults,
    enabled:
      typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    daily:
      Number.isFinite(daily) && daily >= 0
        ? Math.min(Math.floor(daily), 5000)
        : defaults.daily,
    ...(job === 'autopilot'
      ? {
          template:
            typeof value.template === 'string'
              ? value.template
              : defaults.template,
          fields: Array.isArray(value.fields)
            ? value.fields.filter(
                (field): field is string => typeof field === 'string',
              )
            : defaults.fields,
        }
      : {}),
  };
}

/** The day a daily limit counts against — Minsk time, where the shop is. */
export function assistDay(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
