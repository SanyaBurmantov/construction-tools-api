import { AiEntity } from '@prisma/client';

/**
 * For whoever writes prompts without knowing the code — the SEO specialist:
 * what each field is and where the visitor sees it, and ready prompt
 * frameworks to fill in. Shown in /admin/ai «Шаблоны и проверки». A
 * framework is *added* to the built-in rules (the «Дополнительно» part of a
 * task with templates), so it never has to repeat them.
 */
export type FieldGuide = {
  entity: AiEntity;
  key: string;
  label: string;
  /** Where it is seen on the site / in search. */
  where: string;
  /** Length the checks enforce. */
  length: string;
  /** What to keep in mind. */
  notes: string;
};

export const FIELD_GUIDE: FieldGuide[] = [
  {
    entity: AiEntity.PRODUCT,
    key: 'name',
    label: 'Название',
    where:
      'Заголовок H1 карточки, плитки каталога, поиск, корзина, заказы. Из нового названия строится адрес страницы (один раз, со старого — 301).',
    length: 'до 200 символов',
    notes:
      'Бренд, коды модели и все числа старого названия обязаны остаться — по размерам и фасовке работают переключатель размеров, «Фасовки» и подбор крепежа/расходников. Размеры пишутся как у поставщика: «М10х40 мм», «1/2"», «PH2».',
  },
  {
    entity: AiEntity.PRODUCT,
    key: 'descriptionShort',
    label: 'Краткое описание',
    where: 'Под названием в карточке товара; первые строки — в сниппетах.',
    length: '1–2 предложения, до 500 символов',
    notes:
      'Чем товар отличается от соседних размеров/моделей. Только факты из данных.',
  },
  {
    entity: AiEntity.PRODUCT,
    key: 'descriptionFull',
    label: 'Полное описание',
    where: 'Вкладка «Описание» в карточке товара. Основной текст для поиска.',
    length: 'до 6000 символов, простой текст, абзацы',
    notes:
      'Без HTML и Markdown, без цен, телефонов, ссылок, гарантий и «лучший». При скудных данных длинный текст не пишется — проверка «мало данных».',
  },
  {
    entity: AiEntity.PRODUCT,
    key: 'seoTitle',
    label: 'SEO title',
    where:
      'Заголовок страницы в выдаче Яндекса/Google и вкладке браузера. Пока его не написал ИИ или админ, сайт строит его по шаблону из названия.',
    length: 'до 70 символов',
    notes:
      'Главный запрос в начале, без «купить в Минске» (магазин на всю Беларусь).',
  },
  {
    entity: AiEntity.PRODUCT,
    key: 'seoDescription',
    label: 'SEO description',
    where: 'Текст под заголовком в выдаче (сниппет).',
    length: 'до 160 символов (проверка пускает до 230)',
    notes:
      'Обязательно «оплата по безналу для организаций» — проверка без этого не пропустит.',
  },
  {
    entity: AiEntity.CATEGORY,
    key: 'name',
    label: 'Название категории',
    where: 'Меню каталога, H1 страницы категории, хлебные крошки.',
    length: 'до 120 символов',
    notes:
      'Коротко и как ищут: «Анкеры клиновые», не «Анкер клиновой оцинкованный (разные)».',
  },
  {
    entity: AiEntity.CATEGORY,
    key: 'description',
    label: 'Текст категории',
    where:
      'Под сеткой товаров на первой странице категории; первый абзац в две строки — над сеткой.',
    length: 'до 4000 символов, 2–3 абзаца',
    notes:
      'Что входит, на что смотреть при выборе, кому подходит. Без чисел конкретных товаров.',
  },
  {
    entity: AiEntity.CATEGORY,
    key: 'seoTitle',
    label: 'SEO title категории',
    where: 'Заголовок страницы категории в выдаче.',
    length: 'до 70 символов',
    notes: 'Название + уточнение («… для профессионалов», «… в ассортименте»).',
  },
  {
    entity: AiEntity.CATEGORY,
    key: 'seoDescription',
    label: 'SEO description категории',
    where: 'Сниппет категории в выдаче.',
    length: 'до 160 символов',
    notes:
      'Что в категории + «Доставка по Беларуси, оплата по безналу для организаций».',
  },
];

export type PromptScaffold = {
  id: string;
  title: string;
  entity: AiEntity;
  /** Fields to tick in the task wizard for this framework. */
  fields: string[];
  /** What it is for, in one line. */
  goal: string;
  /** The framework; [в скобках] — what to fill in. */
  text: string;
};

export const PROMPT_SCAFFOLDS: PromptScaffold[] = [
  {
    id: 'b2b-description',
    title: 'Уникальное описание под закупщиков (B2B)',
    entity: AiEntity.PRODUCT,
    fields: ['descriptionShort', 'descriptionFull'],
    goal: 'Тексты отличаются от поставщика и отвечают на вопросы закупщика организации.',
    text: `Пиши для закупщика организации: [монтажные бригады / производство / автосервис — оставь нужное].
В первом абзаце — для каких работ и материалов: [перечисли, если знаешь, иначе только по данным].
Ключевая фраза: «[бур SDS-plus 10 мм]» — один раз в первом абзаце, без повторов.
Отдельным абзацем — что важно при закупке партией: фасовка и количество в упаковке из данных.`,
  },
  {
    id: 'seo-query',
    title: 'Title и description под поисковый запрос',
    entity: AiEntity.PRODUCT,
    fields: ['seoTitle', 'seoDescription'],
    goal: 'Сниппет под конкретный запрос из Вордстата.',
    text: `Основной запрос: «[анкер клиновой м10 купить]» — в начале seoTitle, в естественной форме.
Дополнительные запросы для seoDescription (не больше одного): [оптом, для бетона, оцинкованный].
Регион — вся Беларусь, без «Минск».`,
  },
  {
    id: 'clear-name',
    title: 'Понятное название без сокращений',
    entity: AiEntity.PRODUCT,
    fields: ['name'],
    goal: 'Название, которое покупатель понимает и ищет.',
    text: `Порядок: тип товара + бренд + модель + главные размеры.
Пример желаемого вида: «[Анкер клиновой оцинкованный STARFIX М10х120 мм]».
Сокращения поставщика расшифруй: [шестигр. → шестигранный, нерж. → нержавеющий].`,
  },
  {
    id: 'faq',
    title: 'Вопросы и ответы в конце описания',
    entity: AiEntity.PRODUCT,
    fields: ['descriptionFull'],
    goal: 'Ответы на частые вопросы — для поиска и для покупателя.',
    text: `В конце описания добавь 2–3 вопроса с ответами на тему: [как выбрать диаметр бура под анкер / чем отличается SDS-plus от SDS-max].
Ответы — только по данным товара; если данных не хватает, вопрос не добавляй.
Формат: вопрос отдельной строкой, ответ — следующей строкой.`,
  },
  {
    id: 'short-snippet',
    title: 'Краткое описание: отличие от соседних размеров',
    entity: AiEntity.PRODUCT,
    fields: ['descriptionShort'],
    goal: 'Одна-две фразы, по которым видно, чем этот размер/модель отличается.',
    text: `Начни с того, чем этот товар отличается от соседних в линейке: [размер / материал / фасовка].
Без общих слов («качественный», «надёжный»).`,
  },
  {
    id: 'category-text',
    title: 'Текст категории под группу запросов',
    entity: AiEntity.CATEGORY,
    fields: ['description', 'seoTitle', 'seoDescription'],
    goal: 'Страница категории поднимается по группе запросов.',
    text: `Группа запросов категории: [анкеры клиновые, клиновой анкер купить, анкер клиновой оцинкованный].
Главный — в seoTitle и в первом абзаце один раз, остальные — в тексте по смыслу, без перечисления.
Блок «как выбрать»: [по диаметру, по длине, по материалу основания].`,
  },
];
