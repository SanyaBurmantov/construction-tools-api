/**
 * Реквизиты продавца — единственное место, где они заданы.
 * Используются в оферте, политике ПДн, контактах, доставке и футере.
 *
 * ВАЖНО: поля, начинающиеся с «[», — заглушки. Заполните их реальными
 * данными до запуска: страницы выводят их как есть.
 */
export const company = {
  name: 'ООО «Мультитул»',
  unp: '[УНП — заполнить в app/data/company.ts]',
  tradeRegistry: '[дата и номер регистрации в Торговом реестре РБ — заполнить в app/data/company.ts]',
  legalAddress: '[юридический адрес — заполнить в app/data/company.ts]',
  storeAddress: 'г. Витебск, пр-т Фрунзе, 39а, к. 17',
  workingHours: '[режим работы — заполнить в app/data/company.ts]',
  phone: '+375 (29) 813-57-97',
  phoneHref: 'tel:+375298135797',
  email: 'dm.krep@mail.ru',
  emailHref: 'mailto:dm.krep@mail.ru'
} as const

/** true, если в реквизитах остались незаполненные заглушки */
export const companyHasPlaceholders = Object.values(company).some(
  value => value.startsWith('[')
)
