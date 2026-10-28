import { setResponseHeader } from 'h3'
import { company } from '../../app/data/company'

/**
 * llms.txt (llmstxt.org): a Markdown map of the site for language models and
 * AI agents — what the shop is and which pages answer which question. The
 * format asks for one H1 and a short summary; PageSpeed checks exactly that.
 * Built here rather than in `public/` so the requisites come from the one
 * place they are kept (`app/data/company.ts`) and the links from `siteUrl`.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')

  const body = `# Gost.by

> Интернет-магазин инструмента и оборудования в Беларуси для организаций и частных покупателей: 50 000+ позиций, цены обновляются ежедневно, счёт на оплату для юрлиц оформляется прямо на сайте.

Продавец: ${company.name}, УНП ${company.unp}, ${company.legalAddress}. Телефон ${company.phone}, e-mail ${company.email}.

## Каталог

- [Каталог](${siteUrl}/catalog): все категории инструмента и оборудования, фильтры по бренду, цене и наличию
- [Акции](${siteUrl}/sales): товары со скидкой
- [Бренды](${siteUrl}/brand): производители и их товары

## Покупателям

- [Организациям](${siteUrl}/organizaciyam): покупка юрлицом, счёт на оплату, коммерческое предложение, подбор аналогов
- [Доставка и оплата](${siteUrl}/delivery)
- [Гарантия и сервис](${siteUrl}/garantiya)
- [Контакты](${siteUrl}/contacts)

## Optional

- [О компании](${siteUrl}/about)
- [Условия продажи](${siteUrl}/usloviya)
- [Политика обработки персональных данных](${siteUrl}/privacy)
- [Карта сайта](${siteUrl}/sitemap.xml)
`

  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return body
})
