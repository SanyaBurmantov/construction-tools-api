<script setup lang="ts">
import { company } from '~/data/company'

// заглушки вида «[...]» в футер не выводим — там им не место
const unp = company.unp.startsWith('[') ? '' : company.unp
</script>

<template>
  <footer class="site-footer">
    <div class="footer-shell">
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
        <NuxtLink to="/catalog/">Все товары</NuxtLink>
        <NuxtLink to="/brand/">Бренды</NuxtLink>
        <NuxtLink to="/delivery/">Доставка и оплата</NuxtLink>
        <NuxtLink to="/contacts/">Контакты</NuxtLink>
        <NuxtLink to="/oferta/">Публичная оферта</NuxtLink>
        <NuxtLink to="/privacy/">Политика обработки персональных данных</NuxtLink>
      </nav>

      <div class="footer-contact">
        <h2>Контакты</h2>
        <a :href="company.phoneHref">{{ company.phone }}</a>
        <a :href="company.emailHref">{{ company.email }}</a>
        <span>{{ company.storeAddress }}</span>
      </div>
    </div>

    <div class="footer-bottom">
      <span>{{ company.name }}{{ unp ? `, УНП ${unp}` : '' }}</span>
      <span>Цены и наличие обновляются ежедневно.</span>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.site-footer {
  border-top: 1px solid var(--color-line);
  background: white;
  color: var(--color-muted);
}

.footer-shell,
.footer-bottom {
  width: min(1280px, calc(100% - 32px));
  margin: 0 auto;
}

.footer-shell {
  display: grid;
  gap: 28px;
  padding: 36px 0;

  @include media-breakpoint-up(md) {
    grid-template-columns: minmax(0, 1.4fr) 220px 280px;
  }
}

.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #101828;
  text-decoration: none;

  strong,
  small {
    display: block;
  }

  strong {
    font-size: 20px;
    font-weight: 900;
  }

  small {
    color: var(--color-muted);
    font-size: 12px;
  }
}

.brand-mark {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 900;
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
    color: #101828;
    font-size: 15px;
    font-weight: 900;
  }

  a,
  span {
    color: var(--color-muted);
    text-decoration: none;
  }

  a:hover {
    color: var(--color-primary);
  }
}

.footer-bottom {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  justify-content: space-between;
  border-top: 1px solid var(--color-line);
  padding: 16px 0 22px;
  font-size: 13px;
}
</style>
