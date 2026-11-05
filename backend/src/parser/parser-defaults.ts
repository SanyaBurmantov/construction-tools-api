/**
 * Default category filters, kept in a dependency-free module.
 *
 * They are configuration, not logic, and both the parsers and the settings
 * registry need them — putting them in either would make the two import each
 * other. Every value here is only a fallback: a `ParserSetting` row written
 * from /admin/parsing wins, and the matching env var wins over the constant.
 *
 * Both are empty on purpose (owner, 2026-11-05): the shop sells whatever its
 * suppliers carry — car accessories, garden, household goods, cosmetics. The
 * old exclude lists kept ~7.7k products out of the catalogue, and the hidden
 * cards answered «Страница не найдена» to visitors who had found them before.
 * A filter can still be set per source in /admin/parsing.
 */

/** th-tool.by: no default filter — every category is imported. */
export const TH_TOOLS_DEFAULT_EXCLUDE_REGEX = '';

/** tools.by: no default filter — every category is imported. */
export const TOOLS_BY_DEFAULT_EXCLUDE_REGEX = '';
