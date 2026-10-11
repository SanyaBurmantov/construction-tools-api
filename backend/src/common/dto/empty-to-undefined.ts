import type { TransformFnParams } from 'class-transformer';

/**
 * Treats a blank string as "field not filled in".
 *
 * A form submits every input it has, touched or not, so an optional field
 * arrives as `''` — and `@IsOptional()` does **not** skip that: it only skips
 * `null` and `undefined`. Every optional text field with a minimum length
 * therefore rejected an otherwise valid blank form. Creating an admin with no
 * company answered, all at once:
 *
 *   name must be longer than or equal to 1 characters,
 *   phone must be longer than or equal to 3 characters,
 *   companyName must be longer than or equal to 2 characters,
 *   taxId must be longer than or equal to 2 characters
 *
 * Applied to **create** payloads only. On an update `''` is meaningful — it is
 * how a value gets cleared — so those DTOs keep accepting it and the services
 * map it to `null`.
 */
export const emptyToUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
