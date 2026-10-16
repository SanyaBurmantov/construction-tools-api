<script setup lang="ts">
import { company } from '~/data/company'

// заглушки вида «[...]» в футер не выводим — там им не место
const unp = company.unp.startsWith('[') ? '' : company.unp
const currentYear = new Date().getFullYear()
</script>

<template>
  <footer class="site-footer">
    <div class="container footer-shell">
      <div class="footer-brand">
        <NuxtLink to="/" class="brand-link">
          <BrandLogo />
          <small>каталог инструмента и оборудования</small>
        </NuxtLink>
        <p>
          Инструмент, оборудование, крепеж и расходные материалы от поставщиков в одном каталоге.
        </p>
      </div>

      <nav class="footer-nav" aria-label="Ссылки в подвале">
        <h2>Покупателям</h2>
        <NuxtLink to="/catalog">Все товары</NuxtLink>
        <NuxtLink to="/brand">Бренды</NuxtLink>
        <NuxtLink to="/delivery">Доставка и оплата</NuxtLink>
        <NuxtLink to="/contacts">Контакты</NuxtLink>
        <NuxtLink to="/about">О компании</NuxtLink>
        <NuxtLink to="/garantiya">Гарантия и сервис</NuxtLink>
        <NuxtLink to="/usloviya">Условия продажи</NuxtLink>
        <NuxtLink to="/privacy">Политика обработки персональных данных</NuxtLink>
      </nav>

      <div class="footer-contact">
        <h2>Контакты</h2>
        <a :href="company.phoneHref">{{ company.phone }}</a>
        <!-- номер текстом рядом: viber:// без установленного Viber не откроется -->
        <span class="footer-messengers">
          Viber, Telegram: {{ company.phone }}
          <span>
            <a :href="company.viberHref">Viber</a>
            ·
            <a :href="company.telegramHref" target="_blank" rel="noopener">Telegram</a>
          </span>
        </span>
        <a :href="company.emailHref">{{ company.email }}</a>
        <span>{{ company.storeAddress }}</span>
        <span>{{ company.workingHours }}</span>
      </div>
    </div>

    <div class="container footer-bottom">
      <span>© {{ currentYear }} {{ company.name }}{{ unp ? `, УНП ${unp}` : '' }}</span>
      <span>Цены и наличие обновляются ежедневно.</span>
      <span class="footer-disclaimer">
        Информация на сайте, включая цены и наличие товаров, носит ознакомительный
        характер и не является публичной офертой.
      </span>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.site-footer {
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-card);
  color: var(--text-muted);
}

.footer-shell {
  display: grid;
  gap: 28px;
  padding: 36px 0;

  @media (min-width: 640px) {
    grid-template-columns: minmax(0, 1.4fr) 220px 280px;
  }
}

.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-strong);
  text-decoration: none;

  small {
    display: block;
    color: var(--text-muted);
    font-size: 12px;
  }
}

.footer-brand p {
  max-width: 520px;
  margin-top: 14px;
  line-height: 1.7;
}

.footer-nav,
.footer-contact {
  display: grid;
  align-content: start;
  gap: 9px;

  h2 {
    margin-bottom: 4px;
    color: var(--text-strong);
    font-size: 15px;
    font-weight: 900;
  }

  a,
  span {
    color: var(--text-muted);
    text-decoration: none;
  }

  a:hover {
    color: var(--brand);
  }
}

.footer-bottom {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  justify-content: space-between;
  border-top: 1px solid var(--border-subtle);
  padding: 16px 0 22px;
  font-size: 13px;
}

.footer-messengers {
  display: grid;
  gap: 2px;
}

// отдельной строкой во всю ширину, а не третьей колонкой между двумя короткими
.footer-disclaimer {
  flex-basis: 100%;
  font-size: 12px;
}
</style>
