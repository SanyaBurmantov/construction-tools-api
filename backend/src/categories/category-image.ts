/**
 * A category's `image` set to this value means «без картинки»: no photo of
 * its own *and* no borrowed photo of its typical product — the tile shows the
 * letter plate. An empty `image` still means «автоматически» (owner,
 * 2026-11-06: the borrowed photo was sometimes wrong and could not be
 * removed). Never reaches the storefront: the tree turns it into `null`.
 */
export const CATEGORY_NO_IMAGE = 'none';
