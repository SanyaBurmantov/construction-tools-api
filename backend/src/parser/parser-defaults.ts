/**
 * Default category filters, kept in a dependency-free module.
 *
 * They are configuration, not logic, and both the parsers and the settings
 * registry need them — putting them in either would make the two import each
 * other. Every value here is only a fallback: a `ParserSetting` row written
 * from /admin/parsing wins, and the matching env var wins over the constant.
 */

/**
 * th-tool.by is a tool shop that also carries car accessories, bikes and
 * toiletries. The rules deliberately keep "Аксессуары / Измерительные приборы"
 * and "Аксессуары / Спецодежда, защита" — welding masks and PPE live there.
 */
export const TH_TOOLS_DEFAULT_EXCLUDE_REGEX =
  'косметика|автохими|автоламп|антенн|ароматизатор|брелок|ковры напольные|' +
  'кресла детские|очки для чтения|помощь водителю|щ[её]тки стеклоочистител|' +
  'уход за авто|внешний тюнинг|внутрисалонн|велотехник|дача, отдых';

/**
 * tools.by is a tool shop end to end, so there is little to cut — only the
 * household/leisure corners a construction aggregator has no use for.
 */
export const TOOLS_BY_DEFAULT_EXCLUDE_REGEX =
  'товары для дома|товары для уборки|посуда|текстиль|игрушк|' +
  'канцеляр|зоотовар|космет|бытовая химия|продукты питания';

export const SUPPLIER_7745_DEFAULT_INCLUDE_REGEX =
  'запчаст|инструмент|электроинструмент|оснаст|оборудован|строй|строител|' +
  'отделоч|крепеж|фурнитур|сантех|климат|электрик|спецодеж|сиз|' +
  'садовая техника|автотовар';

export const SUPPLIER_7745_DEFAULT_EXCLUDE_REGEX =
  'семена|зоотовары|аквариум|кухон|ванн|космет|спорт|единоборств|' +
  'эпилятор|яйцевар|наушник|гарнитур';
