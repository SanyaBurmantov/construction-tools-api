import { productKind } from './similarity';

/**
 * Compatibility by standard, not by model: a 125 mm disc on a 22.2 mm arbor
 * fits every 125 mm angle grinder, an SDS-plus bit every SDS-plus hammer, an
 * LXT battery every LXT tool — whoever made or supplied either side. Each
 * product gets tags: a TOOL takes `key`, a PART provides it. Read from the
 * name first (that is where suppliers put it), specs as a fallback.
 */
export const FITMENT_RULE_VERSION = 3;

export type FitmentRole = 'TOOL' | 'PART';
export type FitmentTag = { key: string; role: FitmentRole };
export type FitmentInput = {
  name: string;
  brandName?: string | null;
  /** canonicalKey → value, only the keys in FITMENT_SPEC_KEYS. */
  specs?: Record<string, string>;
};

export const FITMENT_SPEC_KEYS = [
  'diametr-kruga~mm',
  'diametr-diska',
  'diametr-diska~mm',
  'tip-patrona',
  'tip-hvostovika',
];

const GRINDER_DIAMETERS = new Set([115, 125, 150, 180, 230]);

const lower = (value: string) => value.toLowerCase().replace(/ё/g, 'е');

/* ---- Battery platforms --------------------------------------------------- */

type Platform = { key: string; title: string };
const PLATFORMS: Record<string, Platform> = {
  'makita-lxt': { key: 'makita-lxt', title: 'Makita LXT 18 В' },
  'makita-cxt': { key: 'makita-cxt', title: 'Makita CXT 12 В' },
  'makita-xgt': { key: 'makita-xgt', title: 'Makita XGT 40 В' },
  'wortex-all1': { key: 'wortex-all1', title: 'WORTEX ALL1' },
  'bull-xltpro': { key: 'bull-xltpro', title: 'BULL XLTpro' },
  'milwaukee-m12': { key: 'milwaukee-m12', title: 'Milwaukee M12' },
  'milwaukee-m18': { key: 'milwaukee-m18', title: 'Milwaukee M18' },
};

/**
 * The platform a cordless product belongs to, only when it is spelled out.
 * Makita's G series (BL1820G, DC18WA) is a separate platform that does not
 * fit LXT — it gets none.
 */
export function batteryPlatform(input: FitmentInput): string | null {
  const name = input.name;
  const brand = lower(`${input.brandName ?? ''} ${name}`);
  const folded = name.toUpperCase().replace(/\s+/g, '');
  if (/makita|макита/.test(brand)) {
    if (/\bBL\s?\d{4}\s?G\b|\bDC18WA\b|G-?SERIES|СЕРИИ\s*G\b/i.test(name))
      return null;
    if (/\bLXT\b/i.test(name)) return 'makita-lxt';
    if (/\bCXT\b/i.test(name)) return 'makita-cxt';
    if (/\bXGT\b/i.test(name)) return 'makita-xgt';
    // Batteries and chargers by their own codes.
    if (
      /BL18\d{2}B?(?!\d)/.test(folded) ||
      /DC18(RC|RD|RE|SD|SH|SF)/.test(folded)
    )
      return 'makita-lxt';
    if (/BL10\d{2}B?(?!\d)/.test(folded) || /DC10(WD|SB|WC)/.test(folded))
      return 'makita-cxt';
    if (/BL40\d{2}(?!\d)/.test(folded) || /DC40R[ABC]/.test(folded))
      return 'makita-xgt';
    return null;
  }
  if (/wortex|вортекс/.test(brand)) {
    // ALL1 is WORTEX's 18 V system; its batteries are the XLT line.
    if (
      /\bALL1\b/i.test(name) ||
      /\bCBL\s?18/i.test(name) ||
      (/\bXLT\b/i.test(name) &&
        /(?:^|\D)18(?:[.,]0)?\s?[ВV](?!\p{L})/iu.test(name))
    )
      return 'wortex-all1';
    return null;
  }
  if (/\bbull\b/.test(brand) && /XLT\s?pro/i.test(name)) return 'bull-xltpro';
  if (/milwaukee/.test(brand)) {
    if (/\bM12\b/i.test(name)) return 'milwaukee-m12';
    if (/\bM18\b/i.test(name)) return 'milwaukee-m18';
  }
  return null;
}

// «Аккумуляторная дрель» is a tool: the battery word must stand alone.
const BATTERY_ITEM =
  /^(?:(?:комплект |набор )?аккумулятор(?:ы|ов)?(?=\s|$)|аккумуляторн\S* батаре|батаре|зарядн|комплект (?:из )?\d+ аккумулятор|зу(?=\s|$)|сетев\S* адаптер)/i;

/* ---- Sizes --------------------------------------------------------------- */

/** «125х1,2х22,2», «125x22мм», «125*1,2*22 мм» → diameter and arbor. */
function discSize(name: string): { diameter: number; bore: number } | null {
  const match =
    /(?:^|[^\d.,])(\d{3})\s*[xх×*]\s*(?:\d+(?:[.,]\d+)?\s*[xх×*]\s*)?(\d{2}(?:[.,]\d{1,2})?)(?![\d.,]*\s*[xх×*]\s*\d)/i.exec(
      name,
    );
  if (!match) return null;
  return {
    diameter: Number(match[1]),
    bore: Number(match[2].replace(',', '.')),
  };
}

/** «125 мм», «Ø125», «(1200 Вт / 180 мм)» — a three-digit millimetre size. */
function millimetres(name: string, allowed: (value: number) => boolean) {
  const sizes = [
    ...name.matchAll(/(?:^|[^\d.,xх×*])(?:ø|Ø|d)?\s*(\d{3})\s*мм/gi),
  ]
    .map((match) => Number(match[1]))
    .filter(allowed);
  return sizes.length === 1 ? sizes[0] : null;
}

function specNumber(input: FitmentInput, keys: string[]): number | null {
  for (const key of keys) {
    const value = input.specs?.[key];
    const number = value ? Number(/\d+/.exec(value)?.[0]) : NaN;
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function sds(text: string): 'plus' | 'max' | null {
  if (/sds\s*[-‐ ]?\s*max/i.test(text)) return 'max';
  if (/sds\s*[-‐ ]?\s*(?:plus|\+|плюс)/i.test(text)) return 'plus';
  return null;
}

/** Makita encodes the disc in the model: GA45xx 115, GA50xx 125 … GA90xx 230. */
function makitaGrinderDiameter(input: FitmentInput): number | null {
  if (!/makita|макита/i.test(`${input.brandName ?? ''} ${input.name}`))
    return null;
  const model = /\bD?GA\s?(\d{2})\d/i.exec(input.name);
  const sizes: Record<string, number> = {
    '45': 115,
    '50': 125,
    '51': 125,
    '60': 150,
    '70': 180,
    '90': 230,
  };
  return model ? (sizes[model[1]] ?? null) : null;
}

/* ---- Fasteners and hand tools ------------------------------------------- */

/** Square drives named in the text («1/2"», «3/8''», «1/4" DR»). */
function drives(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[^\d/&])(1\/4|3\/8|1\/2|3\/4|1)\s?(?:"|''|”|″|дюйм|dr\b)/gi,
  ))
    found.add(match[1]);
  return [...found];
}

/** Metric thread diameter: «М10х40» → 10, «M8» → 8; «М5/8» is not one. */
function threadSize(name: string): string | null {
  const match =
    /(?:^|[^\p{L}\d])[МM]\s?(\d{1,2}(?:[.,]\d)?)(?![\d.,]*\s*\/)/u.exec(name);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  return value >= 2 && value <= 64 ? String(value) : null;
}

/** «Анкер клиновой М10х120» → 10; «Анкер забиваемый М10х12х40» (drop-in) → 12. */
function holeSize(name: string): string | null {
  const dropIn = /[МM]\s?\d+\s?[хx×]\s?(\d{1,2}(?:[.,]\d)?)\s?[хx×]\s?\d+/.exec(
    name,
  );
  const plain =
    /(?:^|[^\d.,])(?:[МMØø]\s?)?(\d{1,2}(?:[.,]\d)?)\s?[хx×*]\s?\d+/.exec(name);
  const value = Number((dropIn ?? plain)?.[1].replace(',', '.'));
  return value >= 4 && value <= 32 ? String(value) : null;
}

const TORX = new Set([
  5, 6, 7, 8, 9, 10, 15, 20, 25, 27, 30, 40, 45, 50, 55, 60,
]);

/**
 * Recess profiles in the text: PH2, PZ2, T25 (TX/TORX/Т25, Cyrillic РН). Read
 * as written, capitals only and not inside a word: «Набор бит 10пр.» is not
 * T10, «7шт» is not T7.
 */
function profiles(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(
    /(?:^|[^\p{L}])(PH|PZ|РН|РZ|PН|РH|TORX|Torx|TX|T|Т)\s?-?(\d{1,2})(?!\d)/gu,
  )) {
    const prefix = match[1]
      .toUpperCase()
      .replace(/Р/g, 'P')
      .replace(/Н/g, 'H')
      .replace(/Т/g, 'T');
    const size = Number(match[2]);
    if (prefix === 'PH' || prefix === 'PZ') {
      if (size <= 4) found.add(`${prefix}${size}`);
    } else if (TORX.has(size)) found.add(`T${size}`);
  }
  return [...found];
}

/**
 * A screw's recess when only its standard says it: DIN 7981/7982/7983/7985
 * and drywall screws are Phillips, sized by the diameter.
 */
function impliedProfile(name: string, text: string): string | null {
  if (!/din\s?798[1235]|гкл|гипсокартон/.test(text)) return null;
  const diameter = Number(
    /(?:^|[^\d.,])[МM]?\s?(\d(?:[.,]\d)?)\s?[хx×]/
      .exec(name)?.[1]
      .replace(',', '.'),
  );
  if (!diameter) return null;
  return diameter <= 3 ? 'PH1' : diameter <= 5 ? 'PH2' : 'PH3';
}

/* ---- Rules --------------------------------------------------------------- */

const ACCESSORY_START =
  /^(?:стойк|кожух|фланец|гайк|ключ|рукоятк|ручк|щетк|якор|статор|ротор|редуктор|шестерн|выключател|кнопк|корпус|подшипник|кабель|шнур|чехол|кейс|сумк|переходник|адаптер|насадк|держател|упор|направляющ|шин|патрон|ствол|боек|ударник|поршен|цилиндр|муфт|втулк|пружин|кольц|сальник|крышк|набор (?:кругов|дисков|бур|бит|сверл))/i;

function isItemTool(name: string, kind: string): boolean {
  return (
    !ACCESSORY_START.test(
      lower(name).replace(/^(?:аккум\.?|аккумуляторн\S*)\s+/, ''),
    ) && Boolean(kind)
  );
}

/**
 * Tags of one product. Pure: same input, same tags — the worker stores them
 * and the read joins TOOL keys to PART keys.
 */
export function fitmentTags(input: FitmentInput): FitmentTag[] {
  const name = input.name.trim();
  const text = lower(name);
  const kind = productKind({
    name,
    brand: input.brandName ? { name: input.brandName } : null,
  });
  const tags: FitmentTag[] = [];
  const add = (key: string, role: FitmentRole) => {
    if (!tags.some((tag) => tag.key === key && tag.role === role))
      tags.push({ key, role });
  };

  // Batteries and chargers ↔ cordless tools of the same platform.
  const platform = batteryPlatform(input);
  if (platform) {
    if (BATTERY_ITEM.test(text)) add(`battery:${platform}`, 'PART');
    else if (
      isItemTool(name, kind) &&
      !/^(?:набор|комплект) (?:бит|сверл|бур)/.test(text)
    )
      add(`battery:${platform}`, 'TOOL');
  }

  // Angle grinders ↔ cutting/grinding discs on a 22.2 mm arbor.
  const grinder =
    /^(?:углошлифмашин|ушм|болгарк)/.test(kind) ||
    (/^шлифмашин/.test(kind) && /углов/.test(text)) ||
    // «Машина шлифовальная угловая», «Угловая шлифовальная машина»
    (/^машин/.test(kind) && /шлифовальн/.test(text) && /углов/.test(text));
  if (grinder && isItemTool(name, kind)) {
    const diameter =
      millimetres(name, (value) => GRINDER_DIAMETERS.has(value)) ??
      makitaGrinderDiameter(input) ??
      specNumber(input, [
        'diametr-kruga~mm',
        'diametr-diska',
        'diametr-diska~mm',
      ]);
    if (diameter && GRINDER_DIAMETERS.has(diameter))
      add(`disc:${diameter}`, 'TOOL');
  }
  if (
    /^(?:круг|диск|набор круг|набор диск)/.test(kind) &&
    !/пильн/.test(text) &&
    /(?:отрезн|шлиф|лепестк|зачистн|алмазн|обдир|абразив|по металлу|по бетону|по камню|по керамике|по нерж)/.test(
      text,
    )
  ) {
    const size = discSize(name);
    if (
      size &&
      GRINDER_DIAMETERS.has(size.diameter) &&
      size.bore >= 22 &&
      size.bore < 22.3
    )
      add(`disc:${size.diameter}`, 'PART');
  }

  // Rotary hammers ↔ SDS-plus / SDS-max bits and chisels.
  const shank = sds(
    `${name} ${input.specs?.['tip-patrona'] ?? ''} ${input.specs?.['tip-hvostovika'] ?? ''}`,
  );
  if (/^перфоратор/.test(kind) && isItemTool(name, kind)) {
    // Up to 30 mm in concrete every hammer drill on sale is SDS-plus.
    const capacity = /дж,?\s*(\d{2})\s*мм/i.exec(name);
    const type =
      shank ?? (capacity && Number(capacity[1]) <= 30 ? 'plus' : null);
    if (type) add(`sds:${type}`, 'TOOL');
  }
  if (
    /^(?:бур|зубил|пик|долот|коронк|набор бур|набор зубил)/.test(kind) &&
    shank
  )
    add(`sds:${shank}`, 'PART');

  // Circular saws ↔ saw blades of the same diameter.
  if (
    kind === 'пила' &&
    /(?:циркулярн|дисков|торцовочн|погружн)/.test(text) &&
    isItemTool(name, kind)
  ) {
    const diameter = millimetres(name, (value) => value >= 110 && value <= 355);
    if (diameter) add(`sawblade:${diameter}`, 'TOOL');
  }
  if (/^диск пильн/.test(text)) {
    const size = discSize(name);
    if (size && size.diameter >= 110 && size.diameter <= 355)
      add(`sawblade:${size.diameter}`, 'PART');
  }

  // Screwdrivers ↔ 1/4" hex bits and holders.
  if (
    /^(?:шуруповерт|дрель)/.test(kind) &&
    /шуруповерт/.test(text) &&
    isItemTool(name, kind)
  )
    add('hex:1/4', 'TOOL');
  // «Licota BHE102580 Бита …»: the brand and the article come first.
  const item = (
    input.brandName
      ? text.replace(
          new RegExp(
            `^${lower(input.brandName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`,
          ),
          '',
        )
      : text
  ).replace(/^(?:[a-z0-9-]+\s+)+/, '');
  if (
    /^(?:бит[аы]?|биты|набор бит|вставка \(бита\)|держатель (?:вставок|бит)|битодержател)(?=[\s(]|$)/.test(
      item,
    ) &&
    !/(?:5\/16|3\/8|1\/2|3\/4|10 ?мм|8 ?мм)/.test(text) &&
    !/торцев/.test(text)
  )
    add('hex:1/4', 'PART');

  // Ratchets, breaker bars, torque and impact wrenches ↔ sockets by drive.
  const drive = drives(text);
  if (drive.length === 1) {
    if (
      /^(?:трещотк|вороток|рукоятк|ключ|гайковерт)/.test(kind) &&
      /(?:трещот|вороток|динамометр|гайковерт|рукоятк)/.test(text) &&
      !/^(?:набор|комплект)/.test(text)
    )
      add(`drive:${drive[0]}`, 'TOOL');
    if (
      (/^(?:набор )?головк/.test(kind) &&
        !/(?:триммер|косил|леск)/.test(text)) ||
      (/^вставк/.test(kind) && /торцев/.test(text))
    )
      add(`drive:${drive[0]}`, 'PART');
  }

  // Bolts, screws, studs ↔ nuts and washers of the same metric thread.
  const thread = threadSize(name);
  if (thread) {
    if (/^(?:набор )?(?:болт|винт|шпильк)$/.test(kind))
      add(`thread:M${thread}`, 'TOOL');
    if (/^(?:набор )?(?:гайк|шайб)$/.test(kind))
      add(`thread:M${thread}`, 'PART');
  }

  // Anchors and wall plugs ↔ masonry bits of the hole they need.
  if (/^(?:набор )?(?:анкер|дюбел)/.test(kind)) {
    const hole = holeSize(name);
    if (hole) add(`hole:${hole}`, 'TOOL');
  }
  if (
    /^(?:набор )?бур/.test(kind) ||
    (/^(?:набор )?сверл/.test(kind) &&
      /(?:бетон|камн|кирпич|sds|победит|универсальн)/.test(text))
  ) {
    const hole = holeSize(name);
    if (hole) add(`hole:${hole}`, 'PART');
  }

  // Screws ↔ bits of their recess (PH2, PZ2, T25).
  if (/^(?:набор )?(?:саморез|шуруп|винт)$/.test(kind)) {
    const recess = profiles(name);
    const implied = recess.length ? null : impliedProfile(name, text);
    for (const profile of implied ? [implied] : recess)
      add(`slot:${profile}`, 'TOOL');
  }
  if (
    /^(?:бит[аы]?|биты|набор бит|вставка \(бита\))(?=[\s(]|$)/.test(item) &&
    !/торцев/.test(text)
  )
    for (const profile of profiles(name)) add(`slot:${profile}`, 'PART');

  return tags;
}

/** Group titles: what a tool page lists, and what a part page says it fits. */
export function fitmentTitles(key: string): { parts: string; tools: string } {
  const [type, value] = [
    key.slice(0, key.indexOf(':')),
    key.slice(key.indexOf(':') + 1),
  ];
  switch (type) {
    case 'battery': {
      const title = PLATFORMS[value]?.title ?? value;
      return {
        parts: `Аккумуляторы и зарядные ${title}`,
        tools: `Инструмент ${title}`,
      };
    }
    case 'disc':
      return {
        parts: `Круги и диски ${value} мм`,
        tools: `Болгарки (УШМ) ${value} мм`,
      };
    case 'sds':
      return value === 'max'
        ? { parts: 'Буры и зубила SDS-max', tools: 'Перфораторы SDS-max' }
        : { parts: 'Буры и зубила SDS-plus', tools: 'Перфораторы SDS-plus' };
    case 'sawblade':
      return {
        parts: `Пильные диски ${value} мм`,
        tools: `Дисковые пилы ${value} мм`,
      };
    case 'hex':
      return { parts: 'Биты 1/4"', tools: 'Шуруповёрты' };
    case 'drive':
      return {
        parts: `Головки ${value}"`,
        tools: `Трещотки, воротки и ключи ${value}"`,
      };
    case 'thread':
      return {
        parts: `Гайки и шайбы ${value.replace('M', 'М')}`,
        tools: `Болты, винты и шпильки ${value.replace('M', 'М')}`,
      };
    case 'hole':
      return {
        parts: `Буры и свёрла по бетону ${value} мм`,
        tools: `Анкеры и дюбели под ${value} мм`,
      };
    case 'slot':
      return {
        parts: `Биты ${value}`,
        tools: `Саморезы и шурупы под ${value}`,
      };
    default:
      return { parts: 'Расходники', tools: 'Инструмент' };
  }
}
