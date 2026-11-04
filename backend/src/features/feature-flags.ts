/**
 * Feature flags: a feature ships switched off (or on for admins only), is
 * tried by us on the real site, and is switched on for everyone from
 * /admin/features — or switched off again by the same click, without a
 * rollback. Kill switches are the same thing with `on` as the default: a
 * block that misbehaves can be turned off while the fix is being written.
 *
 * Declared here, in code, on purpose: a flag nobody reads is dead weight, so
 * a flag is added with the code that checks it and removed with it. The DB
 * (`SiteSetting feature.<key>`) holds only an admin's choice; without one the
 * default applies.
 */
export const FEATURE_MODES = ['off', 'admins', 'on'] as const;
export type FeatureMode = (typeof FEATURE_MODES)[number];

export type FeatureFlag = {
  key: string;
  name: string;
  description: string;
  default: FeatureMode;
};

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'cart-suggestions',
    name: '«Не забудьте к заказу» в корзине',
    description:
      'Аксессуары и расходники к инструменту в корзине (GET /recommendations/cart). Выключатель на случай, если подборка начнёт советовать не то.',
    default: 'on',
  },
  {
    key: 'client-error-reports',
    name: 'Отчёты об ошибках JavaScript',
    description:
      'Браузеры посетителей присылают свои ошибки в «Ошибки» → «Браузер». Выключатель, если какой-то браузер начнёт заваливать журнал.',
    default: 'on',
  },
];

export const featureKey = (key: string) => `feature.${key}`;

export function isFeatureMode(value: unknown): value is FeatureMode {
  return (FEATURE_MODES as readonly unknown[]).includes(value);
}

/** Every declared flag with its effective mode: stored choice, else default. */
export function resolveFlags(
  stored: Map<string, string>,
): Record<string, FeatureMode> {
  const result: Record<string, FeatureMode> = {};
  for (const flag of FEATURE_FLAGS) {
    const value = stored.get(featureKey(flag.key));
    result[flag.key] = isFeatureMode(value) ? value : flag.default;
  }
  return result;
}
