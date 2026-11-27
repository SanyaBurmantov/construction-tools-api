import { capOfVariant, storedCaps, VARIANT_CAPS } from './variant-url';

/**
 * Pure rules of slimming the old four-size photo sets down to 320/640
 * (MediaSlimService). Owner, 2026-11-27: hoster.by counted 1.15 M small
 * files as 65 GB of a 65 GB plan while they held 24 GB, so 160 and 1200
 * went — the two cut the file count in half and 1200 was ~half the bytes.
 */

/** Caps the old sets had that no set keeps now. */
export const DROPPED_CAPS = [160, 1200] as const;

export type SlimPlan = {
  /** The key the set is named by from now on (its largest kept file). */
  key: string;
  /** Files that must exist before anything is deleted; their sizes are the new `bytes`. */
  keep: string[];
  /** Files to delete. A key that is already gone is fine (S3 says «deleted»). */
  drop: string[];
};

/**
 * What to do with one stored set, from its key (`v/ab/<sha1>/1200.webp`).
 * Null when there is nothing to do: not a variant key, or an original so
 * small that its one file is 160.
 *
 * Both old caps are always dropped, whatever the key names: a batch whose
 * delete failed after the database was rewritten (key → 640) is retried, and
 * its 1200 must still go.
 */
export function slimPlan(key: string): SlimPlan | null {
  const top = capOfVariant(key);
  if (top === null || top < VARIANT_CAPS[0]) return null;
  const prefix = key.slice(0, key.lastIndexOf('/') + 1);
  const keep = storedCaps(top).map((cap) => `${prefix}${cap}.webp`);
  return {
    key: keep[keep.length - 1],
    keep,
    drop: DROPPED_CAPS.map((cap) => `${prefix}${cap}.webp`),
  };
}

/**
 * SQL regexp that renames a stored URL naming 1200 to its 640 — for rows
 * that only hold a copy of the URL (order lines, category tiles) and rows a
 * parse rewrote from a stale key while the pass ran.
 */
export const URL_1200_PATTERN = '(/v/[0-9a-f]{2}/[0-9a-f]{40}/)1200\\.webp$';
export const URL_1200_REPLACEMENT = '\\1640.webp';
