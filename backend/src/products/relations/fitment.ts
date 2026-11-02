import { productKind } from './similarity';

/**
 * Compatibility by standard, not by model: a 125 mm disc on a 22.2 mm arbor
 * fits every 125 mm angle grinder, an SDS-plus bit every SDS-plus hammer, an
 * LXT battery every LXT tool — whoever made or supplied either side. Each
 * product gets tags: a TOOL takes `key`, a PART provides it. Read from the
 * name first (that is where suppliers put it), specs as a fallback.
 */
export const FITMENT_RULE_VERSION = 4;

export type FitmentRole = 'TOOL' | 'PART';
export type FitmentTag = { key: string; role: FitmentRole };
export type FitmentInput = {
  name: string;
  brandName?: string | null;
  /** canonicalKey → value, only the keys in FITMENT_SPEC_KEYS. */
  specs?: Record<string, string>;
};

/* Spec keys each rule reads, as the catalogue spells them (production names). */
const GRINDER_DISC_SPECS = [
  'diametr-kruga~mm',
  'diametr-kruga',
  'diametr-diska',
  'diametr-diska~mm',
];
const SPINDLE_SPECS = ['rezba-shpindelya'];
const SAW_BLADE_SPECS = [
  'diametr-pilnogo-diska~mm',
  'diametr-pilnogo-diska',
  'diametr-diska~mm',
  'diametr-diska',
  'diametr-kruga~mm',
  'diametr-diska-pily',
  'diametr-diska-o',
  'parametry-diska~mm',
  'parametry-diska-pilnogo',
  'parametry-pilnogo-diska-komplekte',
  'parametry-rezhushchego-diska',
];
const CHAIN_PITCH_SPECS = ['shag-cepi', 'shag-cepi~dyujm'];
const CHAIN_GAUGE_SPECS = [
  'shirina-paza~mm',
  'shirina-paza',
  'shirina-paza-cepi',
  'shirina-paza-cepi~mm',
  'shirina-paza-shiny~mm',
  'shirina-vedushchego-paza-shiny',
  'paz-shiny~mm',
];
const CHAIN_LINK_SPECS = [
  'kolvo-zvenev',
  'kolvo-zvenev~sht',
  'kolvo-zvenev-cepi',
];
const LINE_SPECS = [
  'tolshchina-leski~mm',
  'tolshchina-leski',
  'diametr-leski~mm',
  'maks-diametr-leski',
  'sechenie-leski',
  'diametr~mm',
];
const HOLE_SPECS = [
  'diametr-ankera-sverla~mm',
  'diametr-dyubelya-sverla~mm',
  'diametr-sverleniya~mm',
  'diametr-otverstiya~mm',
];
const DRIVE_SPECS = [
  'posadochnyj-razmer',
  'razmer-prisoedinitelnogo-kvadrata',
  'kvadrat',
  'tip-posadki',
  'razmer-patrona',
  'razmer-patrona~mm',
  'tip-patrona',
];

export const FITMENT_SPEC_KEYS = [
  ...new Set([
    ...GRINDER_DISC_SPECS,
    ...SPINDLE_SPECS,
    ...SAW_BLADE_SPECS,
    ...CHAIN_PITCH_SPECS,
    ...CHAIN_GAUGE_SPECS,
    ...CHAIN_LINK_SPECS,
    ...LINE_SPECS,
    ...HOLE_SPECS,
    ...DRIVE_SPECS,
    'tip-patrona',
    'tip-hvostovika',
  ]),
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

function sds(text: string): 'plus' | 'max' | null {
  if (/sds\s*[-‐ ]?\s*max/i.test(text)) return 'max';
  if (/sds\s*[-‐ ]?\s*(?:plus|\+|плюс)/i.test(text)) return 'plus';
  return null;
}

/**
 * A size spec holding one millimetre value: «190», «165 мм», «210х30х24Т»,
 * «165мм х 20мм х 24Т», «355 x 25,4 mm» — the leading number. A range
 * («136 - 150 мм») or a value in inches is no answer.
 */
function specMillimetres(
  input: FitmentInput,
  keys: string[],
  allowed: (value: number) => boolean,
): number | null {
  for (const key of keys) {
    const match =
      /^\s*[øØd]?\s*(\d{1,3})(?:[.,]0+)?\s*(?:мм|mm)?\s*(?:[xх×*]|\(|$)/i.exec(
        input.specs?.[key] ?? '',
      );
    const value = Number(match?.[1]);
    if (match && allowed(value)) return value;
  }
  return null;
}

const isMakita = (input: FitmentInput) =>
  /makita|макита/i.test(`${input.brandName ?? ''} ${input.name}`);

/**
 * Makita encodes the disc in the model: GA45xx 115, GA50xx 125 … GA90xx 230.
 * The 40 V XGT line (GA0NNG) does not, so those are listed one by one —
 * only models whose disc is confirmed (Makita's own pages, supplier texts).
 */
function makitaGrinderDiameter(input: FitmentInput): number | null {
  if (!isMakita(input)) return null;
  const xgt = /\bGA\s?0(\d{2})\s?G/i.exec(input.name);
  if (xgt) {
    const sizes: Record<string, number> = {
      '05': 125,
      '12': 115,
      '13': 125,
      '23': 125,
      '29': 125,
      '36': 150,
      '37': 180,
      '38': 230,
      '50': 125,
    };
    return sizes[xgt[1]] ?? null;
  }
  const classic = /\b(9558|9565|9069)\b/.exec(input.name);
  if (classic) return { '9558': 125, '9565': 125, '9069': 230 }[classic[1]]!;
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

/** ФИОЛЕНТ writes the disc as the last part of the model: «МШУ 2-9-125». */
function fiolentGrinderDiameter(name: string): number | null {
  const match = /МШУ\s?\d+-\d+-(\d{3})/i.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Makita saws whose blade is not in the name: model → blade diameter. Each
 * one is confirmed by the supplier's own spec or text in the catalogue (or
 * Makita's page for RS001G / LS1110F); models we could not confirm (HS004G,
 * RS002G) are left out on purpose.
 */
const MAKITA_SAW_BLADES: Array<[RegExp, number]> = [
  [/\bHS\s?7601\b/i, 190],
  [/\bHS\s?7611\b/i, 190],
  [/\bHS\s?7600\b/i, 185],
  [/\bHS\s?6601\b/i, 165],
  [/\bHS\s?0600\b/i, 270],
  [/\bHS\s?009\s?G/i, 235],
  [/\bRS\s?001\s?G/i, 185],
  [/\b5008\s?MG/i, 210],
  [/\b5007\s?N\b/i, 185],
  [/\b5477\s?NB\b/i, 185],
  [/\b5903\s?R\b/i, 235],
  [/\bN\s?5900\s?B\b/i, 235],
  [/\bSP\s?6000\b/i, 165],
  [/\bDHS\s?6[68]\d\b/i, 165],
  [/\bDHS\s?710\b/i, 190],
  [/\bDSS\s?610\b/i, 165],
  [/\bDSP\s?60[01]\b/i, 165],
  [/\bDRS\s?780\b/i, 185],
  [/\bLS\s?0714\b/i, 190],
  [/\bLS\s?0815\b/i, 216],
  [/\bLS\s?1040\b/i, 255],
  [/\bLS\s?101[89]\b/i, 260],
  [/\bLS\s?1110\s?F\b/i, 260],
  [/\bLS\s?1219\b/i, 305],
  [/\bLH\s?1040\b/i, 260],
  [/\bLH\s?1201\b/i, 305],
  [/\bMLT\s?100\b/i, 260],
];

function makitaSawDiameter(input: FitmentInput): number | null {
  if (!isMakita(input)) return null;
  return (
    MAKITA_SAW_BLADES.find(([pattern]) => pattern.test(input.name))?.[1] ?? null
  );
}

/**
 * A blade's diameter: the first «D x …» of the name («190х30/20», «260X30X2.6X100T»,
 * «165х2.2х20» — kerf before bore is how MAKITA writes it).
 */
function bladeDiameter(name: string): number | null {
  const match = /(?:^|[^\d.,])(\d{2,3})\s*(?:мм)?\s*[xх×*]\s*\d/i.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Makita rotary hammers by model, where the name omits the shank: HR16xx–
 * HR28xx, HR32xx, the 18 V DHR1xx/2xx and the 12 V HR1xxD are SDS-plus;
 * HR40xx–HR52xx are SDS-max. The XGT HR0xxG and HR3xxx other than HR32xx
 * are left to their specs.
 */
function makitaHammerShank(input: FitmentInput): 'plus' | 'max' | null {
  if (!isMakita(input)) return null;
  const model = /\b(D?)HR\s?(\d{3,4})(?!\d)/i.exec(input.name);
  if (!model) return null;
  const digits = model[2];
  if (digits.length === 4) {
    const series = Number(digits.slice(0, 2));
    if ((series >= 16 && series <= 28) || series === 32) return 'plus';
    if (series >= 40 && series <= 52) return 'max';
    return null;
  }
  return /^[12]/.test(digits) ? 'plus' : null;
}

/* ---- Saw chains ---------------------------------------------------------- */

type Pitch = '3/8LP' | '3/8' | '.325' | '1/4' | '.404';

function pitchOf(text: string): Pitch | null {
  const found = new Set<Pitch>();
  if (/3\/8\s*(?:"|''|”|″)?\s*lp\b|\blp\b/i.test(text)) found.add('3/8LP');
  else if (/(?:^|[^\d/])3\/8(?![\d/])/.test(text)) found.add('3/8');
  if (/(?:^|[^\d])0?[.,]325/.test(text)) found.add('.325');
  if (/(?:^|[^\d/])1\/4\s*(?:"|''|”|″)/.test(text)) found.add('1/4');
  if (/(?:^|[^\d])0?[.,]404/.test(text)) found.add('.404');
  return found.size === 1 ? [...found][0] : null;
}

/** Supplier spec spellings: «3/8" LP», «38», «3/8 (0.375) дюйм», «0,325"», «14». */
function specPitch(input: FitmentInput): Pitch | null {
  for (const key of CHAIN_PITCH_SPECS) {
    const value = (input.specs?.[key] ?? '').trim();
    if (!value) continue;
    if (/^38(?:\D|$)/.test(value) && !/lp/i.test(value)) return '3/8';
    if (/^14(?:\D|$)/.test(value)) return '1/4';
    return pitchOf(value);
  }
  return null;
}

/** Drive-link gauge, mm: 1.1 / 1.3 / 1.5 / 1.6. */
function gaugeOf(input: FitmentInput, name: string): string | null {
  // Every gauge the name and the specs state must agree: a saw whose bar
  // spec says 1.3 while the chain says 1.1 is a data error, not a fit.
  const found = new Set(
    [...name.matchAll(/(?:^|[^\d.,])(1[.,][1356])\s*мм/gi)].map((match) =>
      match[1].replace(',', '.'),
    ),
  );
  for (const key of CHAIN_GAUGE_SPECS) {
    const match = /^\s*(1[.,][1356])\s*(?:мм)?(?:\s*-\s*0?\.0\d+")?\s*$/i.exec(
      input.specs?.[key] ?? '',
    );
    if (match) found.add(match[1].replace(',', '.'));
  }
  return found.size === 1 ? [...found][0] : null;
}

function linksOf(input: FitmentInput, name: string): number | null {
  const named = /(?:^|[^\d.,])(\d{2,3})\s*зв/i.exec(name);
  let fromSpec: number | null = null;
  for (const key of CHAIN_LINK_SPECS) {
    const match = /^\s*(\d{2,3})\s*(?:шт)?\s*$/.exec(input.specs?.[key] ?? '');
    if (match) {
      fromSpec = Number(match[1]);
      break;
    }
  }
  const fromName = named ? Number(named[1]) : null;
  if (fromName && fromSpec && fromName !== fromSpec) return null;
  const links = fromName ?? fromSpec;
  return links && links >= 20 && links <= 120 ? links : null;
}

/**
 * A chain is identified by pitch + gauge + drive links, all three exact.
 * «3/8"» without «LP» is low-profile only when the gauge says so (1.1 mm
 * exists only as LP); with 1.3 mm it could be either — no key. A name and a
 * spec that disagree give no key.
 */
function chainKey(input: FitmentInput, name: string): string | null {
  const fromName = pitchOf(name);
  const fromSpec = specPitch(input);
  if (
    fromName &&
    fromSpec &&
    fromName.replace('LP', '') !== fromSpec.replace('LP', '')
  )
    return null;
  let pitch =
    fromName === '3/8' && fromSpec === '3/8LP'
      ? fromSpec
      : (fromName ?? fromSpec);
  const gauge = gaugeOf(input, name);
  const links = linksOf(input, name);
  if (!pitch || !gauge || !links) return null;
  if (pitch === '3/8') {
    if (gauge === '1.1') pitch = '3/8LP';
    else if (gauge === '1.3') return null;
  }
  if (pitch === '3/8LP' && !['1.1', '1.3'].includes(gauge)) return null;
  return `${pitch}-${gauge}-${links}`;
}

/* ---- Trimmer line -------------------------------------------------------- */

/** Line diameter in mm, «1.65» folded into «1.6» (both are 0.065"). */
function lineSize(raw: string): string | null {
  const value = Number(raw.replace(',', '.'));
  if (!(value >= 1.2 && value <= 4)) return null;
  const folded = value === 1.65 ? 1.6 : value;
  return folded.toFixed(2).replace(/0$/, '');
}

function specLine(input: FitmentInput): string | null {
  for (const key of LINE_SPECS) {
    const match = /^\s*(\d(?:[.,]\d{1,2})?)\s*(?:мм)?\s*$/i.exec(
      input.specs?.[key] ?? '',
    );
    if (match) return lineSize(match[1]);
  }
  return null;
}

/* ---- Drives from specs ---------------------------------------------------- */

/**
 * A square drive from a spec: «1/2"», «1/2"DR», «Квадрат 12» (Makita's
 * «1/2» without the slash), «Внешн. квадрат, 1/2"»; a combined «внутренняя
 * 1/4" / внешняя 1/2"» reads the outer square.
 */
function specDrive(input: FitmentInput): string | null {
  for (const key of DRIVE_SPECS) {
    let value = lower(input.specs?.[key] ?? '');
    if (!value) continue;
    const outer = /(?:внешн|наружн)(.*)$/.exec(value);
    if (outer && /внутр/.test(value)) value = outer[1];
    if (/шестигр/.test(value) && !outer) continue;
    const square = /квадрат\D*?\b(12|38|14|34)\b/.exec(value);
    if (square)
      return { '12': '1/2', '38': '3/8', '14': '1/4', '34': '3/4' }[square[1]]!;
    const found = new Set(
      [
        ...value.matchAll(/(?:^|[^\d/.,])(1\/4|3\/8|1\/2|3\/4|1)(?![\d/.,])/g),
      ].map((match) => match[1]),
    );
    if (found.size === 1) return [...found][0];
  }
  return null;
}

/* ---- Fasteners and hand tools ------------------------------------------- */

/** Square drives named in the text («1/2"», «3/8''», «1/4" DR»). */
function drives(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(
    // «1.1/2"» and «2.1/2"» are 1-1/2" and 2-1/2", not 1/2".
    /(?<![\d/&]|\d\.)(1\/4|3\/8|1\/2|3\/4|1)\s?(?:"|''|”|″|дюйм|dr\b)/gi,
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
  // «Гайковерт» opens with «гайк», so ACCESSORY_START cannot judge it: a
  // wrench's spare part says what it is for instead («Привод для гайковерта»).
  const forWrench =
    /(?:^|\s)(?:для|к)\s+(?:\S+\s+)?(?:пневмо)?(?:гайковерт|винтоверт)/.test(
      text,
    );
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
    // «Машина шлифовальная угловая», «Углошлифовальная машина (УШМ, Болгарка)»
    (/^машин/.test(kind) &&
      (/углошлифовальн|(?:^|[^\p{L}])ушм(?![\p{L}])|болгарк/u.test(text) ||
        (/шлифовальн/.test(text) && /углов/.test(text))));
  if (grinder && isItemTool(name, kind)) {
    const diameter =
      millimetres(name, (value) => GRINDER_DIAMETERS.has(value)) ??
      makitaGrinderDiameter(input) ??
      fiolentGrinderDiameter(name) ??
      specMillimetres(input, GRINDER_DISC_SPECS, (value) =>
        GRINDER_DIAMETERS.has(value),
      );
    if (diameter && GRINDER_DIAMETERS.has(diameter)) {
      add(`disc:${diameter}`, 'TOOL');
      // Every 115–230 mm angle grinder on sale here has an M14 spindle; a
      // spec naming another thread wins.
      const spindle = input.specs?.['rezba-shpindelya'];
      if (!spindle || /^\s*[МM]\s?14(?!\d)/i.test(spindle))
        add('spindle:M14', 'TOOL');
    }
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

  // Grinder accessories on the M14 spindle thread: wire brushes, backing
  // pads, flap discs and diamond crowns that state «М14» (not the fine
  // М14х1,25/1,5 of spark plugs and fittings). Polishing sponges and pads
  // count only when they name the grinder — they are polisher parts.
  if (
    /(?:^|[^\p{L}\d])[МM]\s?14(?![\d.,])(?!\s*[хx×*]\s*1[.,])/u.test(name) &&
    (/^(?:набор )?(?:щетк|кордщетк|коронк|тарелк|круг|чашк|фрез)/.test(kind) ||
      (/(?:(?:^|[^\p{L}])ушм(?![\p{L}])|болгарк|углошлиф)/u.test(text) &&
        /^(?:набор )?(?:губк|подошв|держател|диск|насадк)/.test(kind)))
  )
    add('spindle:M14', 'PART');

  // Rotary hammers ↔ SDS-plus / SDS-max bits and chisels.
  const shank = sds(
    `${name} ${input.specs?.['tip-patrona'] ?? ''} ${input.specs?.['tip-hvostovika'] ?? ''}`,
  );
  if (/^перфоратор/.test(kind) && isItemTool(name, kind)) {
    // Up to 30 mm in concrete every hammer drill on sale is SDS-plus.
    const capacity = /дж,?\s*(\d{2})\s*мм/i.exec(name);
    const type =
      shank ??
      makitaHammerShank(input) ??
      (capacity && Number(capacity[1]) <= 30 ? 'plus' : null);
    if (type) add(`sds:${type}`, 'TOOL');
  }
  if (
    /^(?:бур|зубил|пик|долот|коронк|набор бур|набор зубил)/.test(kind) &&
    shank
  )
    add(`sds:${shank}`, 'PART');

  // Circular saws ↔ saw blades of the same diameter.
  const sawSize = (value: number) => value >= 85 && value <= 355;
  if (
    kind === 'пила' &&
    /(?:циркулярн|дисков|торцовочн|погружн)/.test(text) &&
    isItemTool(name, kind)
  ) {
    const diameter =
      millimetres(name, (value) => value >= 110 && value <= 355) ??
      // «165х20 мм», «185х20х24Т», «(190*30 мм» — a blade size, not a cut.
      (/(?:^|[^\d.,])\d{3}\s*(?:мм)?\s*[xх×*]\s*\d/i.test(name)
        ? bladeDiameter(name)
        : null) ??
      makitaSawDiameter(input) ??
      specMillimetres(input, SAW_BLADE_SPECS, sawSize);
    if (diameter && sawSize(diameter)) add(`sawblade:${diameter}`, 'TOOL');
  }
  if (
    /^(?:набор )?диск/.test(kind) &&
    (/пильн/.test(text) || /\d\s?(?:зуб|t(?![\p{L}]))/u.test(text)) &&
    // Brush-cutter blades and grinder wood discs are not circular-saw blades.
    !/(?:кустарн|мотокос|триммер|косил|ушм|болгарк|отрезн|алмазн|шлиф)/.test(
      text,
    )
  ) {
    const diameter = bladeDiameter(name);
    if (diameter && sawSize(diameter)) add(`sawblade:${diameter}`, 'PART');
  }

  // Chainsaws and pole saws ↔ chains of the same pitch, gauge and links.
  if (
    ((kind === 'пила' && /цепн/.test(text)) ||
      /^(?:бензопил|электропил|высоторез)/.test(kind)) &&
    !/без шины/.test(text) &&
    isItemTool(name, kind)
  ) {
    const chain = chainKey(input, name);
    if (chain) add(`chain:${chain}`, 'TOOL');
  }
  if (
    /^(?:набор )?цеп/.test(kind) &&
    !/(?:сварн|din|такелаж|лебед|крюк|грм|бухт)/.test(text)
  ) {
    const chain = chainKey(input, name);
    if (chain) add(`chain:${chain}`, 'PART');
  }

  // Trimmers and their heads ↔ line of the diameter they take.
  if (
    (/^(?:триммер|мотокос|бензокос|травокос)/.test(kind) &&
      isItemTool(name, kind)) ||
    (/^головк/.test(kind) && /триммерн/.test(text))
  ) {
    const stated = /леск[аи]?\s*(?:ф\.?\s*)?(\d[.,]\d{1,2})\s*мм/i.exec(name);
    const line = (stated ? lineSize(stated[1]) : null) ?? specLine(input);
    if (line) add(`line:${line}`, 'TOOL');
  }
  if (/^(?:набор )?леск/.test(kind) && !/рыбол/.test(text)) {
    const stated =
      /(?:^|[^\d.,])(?:ф|ø|d)?\s*(\d[.,]\d{1,2})\s*мм/i.exec(name) ??
      /(?:^|[^\d.,])(?:ф|ø)\s*(\d)\s*мм/i.exec(name);
    const line = (stated ? lineSize(stated[1]) : null) ?? specLine(input);
    if (line) add(`line:${line}`, 'PART');
  }

  // Screwdrivers ↔ 1/4" hex bits and holders.
  if (
    /^(?:шуруповерт|дрель)/.test(kind) &&
    /шуруповерт/.test(text) &&
    isItemTool(name, kind)
  )
    add('hex:1/4', 'TOOL');
  // Impact drivers take 1/4" hex bits; a «гайковерт/винтоверт» with an inner
  // hex (spec «Внутр. шестигранник 1/4"») is one too.
  if (
    !forWrench &&
    (/^винтоверт/.test(kind) ||
      (/^гайковерт/.test(kind) &&
        (/винтоверт/.test(text) ||
          /внутр\S*\s*шестигр/.test(
            lower(input.specs?.['tip-posadki'] ?? ''),
          ))))
  )
    add('hex:1/4', 'TOOL');
  // Drill bits with a 1/4" hex shank go into the same quick chuck.
  if (
    /^(?:набор )?(?:сверл|зенкер)/.test(kind) &&
    !/sds/.test(text) &&
    (/(?:шестигр|(?:^|[^\p{L}])hex(?![\p{L}]))/u.test(text) ||
      /(?<![\d/]\s?)1\/4\s?(?:"|''|”|″|hex)/.test(text)) &&
    !/(?:3\/8|5\/16|1 1\/4)/.test(text)
  ) {
    const spec = lower(input.specs?.['tip-hvostovika'] ?? '');
    if (!spec || /1\/4|(?:^|\D)14(?!\d)|^шестигранный\s*$|hex/.test(spec))
      add('hexshank:1/4', 'PART');
  }
  if (tags.some((tag) => tag.key === 'hex:1/4' && tag.role === 'TOOL'))
    add('hexshank:1/4', 'TOOL');
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

  // Ratchets, breaker bars, torque wrenches ↔ sockets by drive; impact
  // wrenches ↔ impact sockets only (a chrome socket on an impact wrench
  // cracks). The air inlet («штуцер 1/4''») is not a drive.
  const named = drives(text.replace(/(?:штуцер|вход\S*)\s*[^\s,)]*/g, ''));
  const drive =
    named.length === 1
      ? named[0]
      : named.length === 0 && !/\d\s?[&.-]\s?\d\/\d/.test(text)
        ? specDrive(input)
        : null;
  if (drive && !/^(?:набор|комплект)/.test(text)) {
    const wrench = /^(?:пневмо)?гайковерт/.test(kind);
    // Ratchet wrenches («пневмогайковерт-трещотка», a non-impact «угловой
    // гайковерт») and hand torque multipliers take ordinary sockets.
    const handDriven =
      /(?:трещот|храпов|ручн|механич|редуктор|мясорубк|укм)/.test(text) ||
      (/углов/.test(text) && !/ударн/.test(text));
    if (wrench && /(?:гидравл|кассетн)/.test(text)) {
      // Hydraulic wrenches take their own cassettes.
    } else if (wrench && !handDriven) {
      if (!forWrench) add(`impact:${drive}`, 'TOOL');
    } else if (
      /^(?:трещотк|вороток|рукоятк|ключ|гайковерт|пневмогайковерт)/.test(
        kind,
      ) &&
      /(?:трещот|вороток|динамометр|гайковерт|рукоятк)/.test(text)
    )
      add(`drive:${drive}`, 'TOOL');
  }
  if (drive) {
    const socket =
      (/^(?:набор )?головк/.test(kind) &&
        !/(?:триммер|косил|леск)/.test(text)) ||
      (/^вставк/.test(kind) && /торцев/.test(text));
    if (socket) {
      add(`drive:${drive}`, 'PART');
      if (/(?:ударн|impact)/.test(text)) add(`impact:${drive}`, 'PART');
    }
  }

  // Bolts, screws, studs ↔ nuts and washers of the same metric thread.
  const thread = threadSize(name);
  if (thread) {
    if (/^(?:набор )?(?:болт|винт|шпильк)$/.test(kind))
      add(`thread:M${thread}`, 'TOOL');
    if (/^(?:набор )?(?:гайк|шайб)$/.test(kind))
      add(`thread:M${thread}`, 'PART');
  }

  // Anchors and wall plugs ↔ masonry bits of the hole they need. The spec's
  // drill size wins over the name. A hollow-wall anchor's name gives the
  // screw, not the hole («молли 5х52» goes into 11 mm), a cable clip's the
  // cable, a spring toggle's the thread; nail plugs for a powder gun and
  // self-drilling drywall plugs need no drilled hole at all — those trust
  // only the spec. A plastic «бабочка 10х50» is named by its hole.
  if (/^(?:набор )?(?:анкер|дюбел)/.test(kind)) {
    const spec = specMillimetres(
      input,
      HOLE_SPECS,
      (value) => value >= 4 && value <= 32,
    );
    const byName =
      /бабочк/.test(text) ||
      !/(?:пустотел|полых|молли|гипсокартон|гкл|driva|дрива|складн|пружин|дюбель-хомут|пистолет|самосверл)/.test(
        text,
      );
    const hole = spec ? String(spec) : byName ? holeSize(name) : null;
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
    case 'hexshank':
      return {
        parts: 'Свёрла с хвостовиком 1/4"',
        tools: 'Шуруповёрты',
      };
    case 'spindle':
      return {
        parts: 'Щётки, коронки и насадки М14 для УШМ',
        tools: 'Болгарки (УШМ) со шпинделем М14',
      };
    case 'impact':
      return {
        parts: `Ударные головки ${value}"`,
        tools: `Ударные гайковёрты ${value}"`,
      };
    case 'chain': {
      const [pitch, gauge, links] = value.split('-');
      const spelled = `${pitch.replace('LP', '" LP').replace(/^(\d\/\d|\.\d+)$/, '$1"')}, ${gauge.replace('.', ',')} мм, ${links} зв.`;
      return {
        parts: `Цепи ${spelled}`,
        tools: `Цепные пилы под цепь ${spelled}`,
      };
    }
    case 'line':
      return {
        parts: `Леска ${value.replace('.', ',')} мм`,
        tools: `Триммеры и головки под леску ${value.replace('.', ',')} мм`,
      };
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
