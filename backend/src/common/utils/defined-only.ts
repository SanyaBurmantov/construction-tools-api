/**
 * The fields a partial-update request actually sent.
 *
 * The backend compiles to ES2023, where every field a DTO class declares is
 * an own property of the instance — `undefined` when the request left it
 * out. So `{ ...stored, ...dto }` overwrote the stored values with
 * `undefined`: a one-click «вкл/выкл» (`PATCH {isActive:false}`) on a promo
 * code or a banner lost the code and answered 500. `null` is kept — on an
 * update it means «clear this».
 */
export function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
