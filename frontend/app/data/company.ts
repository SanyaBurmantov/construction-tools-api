/**
 * Реквизиты продавца — единственное место, где они заданы.
 * Используются в условиях продажи, политике ПДн, контактах, доставке,
 * «О компании», «Гарантии» и футере.
 *
 * ВАЖНО: поля, начинающиеся с «[», — заглушки. Заполните их реальными
 * данными до запуска: страницы выводят их как есть.
 */
export const company = {
  name: 'ООО «Мультитул»',
  unp: '391807521',
  legalAddress: 'г. Витебск, пр-т Фрунзе, 39а-18',
  storeAddress: 'г. Витебск, пр-т Фрунзе, 39а, к. 17',
  workingHours: 'Пн–Пт; суббота и воскресенье — выходной',
  phone: '+375 (29) 813-57-97',
  phoneHref: 'tel:+375298135797',
  email: 'dm.krep@mail.ru',
  emailHref: 'mailto:dm.krep@mail.ru',
  // Мессенджеры привязаны к тому же номеру, что и телефон. Ссылки рядом всегда
  // дублируются номером текстом: viber:// без установленного Viber не откроется.
  viberHref: 'viber://chat?number=%2B375298135797',
  telegramHref: 'https://t.me/+375298135797'
} as const

/** true, если в реквизитах остались незаполненные заглушки */
export const companyHasPlaceholders = Object.values(company).some(
  value => value.startsWith('[')
)

/**
 * Поля, которые всё ещё содержат заглушку. Выводятся в админке, чтобы
 * квадратные скобки не уезжали в прод молча: эти значения видны покупателю
 * в футере, условиях продажи, политике ПДн и контактах.
 */
export const companyPlaceholderFields = Object.entries(company)
  .filter(([, value]) => value.startsWith('['))
  .map(([key]) => key)

/** Человекочитаемые названия для предупреждения в админке. */
export const COMPANY_FIELD_LABELS: Record<string, string> = {
  unp: 'УНП',
  legalAddress: 'Юридический адрес',
  storeAddress: 'Адрес магазина',
  workingHours: 'Режим работы',
  phone: 'Телефон',
  email: 'Email',
  viberHref: 'Ссылка Viber',
  telegramHref: 'Ссылка Telegram',
  name: 'Название организации'
}
