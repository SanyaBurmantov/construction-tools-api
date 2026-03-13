<script setup lang="ts">
// Заглушки для будущих данных
const city = ref('г. Минск')
const phones = [
  { label: '+375 29 664-77-45', href: 'tel:+375296647745', operator: 'velcom' },
  { label: '+375 29 764-77-45', href: 'tel:+375297647745', operator: 'mts' },
  { label: '+375 25 964-77-45', href: 'tel:+375259647745', operator: 'life' },
]
const workTime = 'с 8:00 до 22:00'

const topLinks = [
  { label: 'Услуги', to: '/catalog/uslugi', highlight: true },
  { label: 'Контакты', to: '/contacts' },
  { label: 'Пункты выдачи', to: '/buyer/delivery/pickup/' },
  { label: 'Доставка', to: '/buyer/delivery/common' },
  { label: 'Оплата', to: '/buyer/payment/prepayment' },
  { label: 'Рассрочка и Кредит', to: '/buyer/credit/rassrochka-banka' },
  { label: 'Акции', to: '/sale', highlight: true },
  { label: 'Уценка', to: '/catalog/ucenennye-tovary', highlight: 'green' },
  {
    label: 'Еще',
    to: '#',
    submenu: [
      { label: 'О магазине', to: '/about/shop' },
      { label: 'Бонусы и скидки', to: '/about/bonusy-i-skidki' },
      { label: 'Рейтинг отзывов', to: '/reiting-otzyvov' },
      { label: 'Новости', to: '/news' },
      { label: 'Статьи', to: '/articles' },
      { label: 'Идеи подарков', to: '/podarki' },
    ]
  },
]
</script>

<template>
  <div class="top-bar">
    <div class="top-bar__container">
      <!-- Гео -->
      <div class="top-bar__geo">
        <button class="top-bar__city-btn">
          {{ city }}
          <span class="top-bar__icon">📍</span>
        </button>
      </div>

      <!-- Телефоны и время -->
      <div class="top-bar__contacts">
        <div class="top-bar__phones">
          <a
            v-for="phone in phones"
            :key="phone.label"
            :href="phone.href"
            class="top-bar__phone"
          >
            <span class="top-bar__operator">{{ phone.operator }}</span>
            <span>{{ phone.label }}</span>
          </a>
          <a href="tel:7745" class="top-bar__phone top-bar__phone--unified">
            Единый моб. — 7745
          </a>
        </div>
        <div class="top-bar__schedule">
          <span class="top-bar__label">Контакт-центр</span> {{ workTime }}
        </div>
      </div>

      <!-- Доп. навигация -->
      <nav class="top-bar__nav">
        <ul class="top-bar__list">
          <li
            v-for="link in topLinks"
            :key="link.label"
            class="top-bar__item"
            :class="{
              'top-bar__item--highlight': link.highlight,
              'top-bar__item--submenu': link.submenu
            }"
          >
            <NuxtLink
              :to="link.to"
              class="top-bar__link"
              :class="{
                'top-bar__link--orange': link.highlight === true,
                'top-bar__link--green': link.highlight === 'green'
              }"
            >
              {{ link.label }}
            </NuxtLink>

            <!-- Подменю (заглушка) -->
            <ul v-if="link.submenu" class="top-bar__submenu">
              <li v-for="sub in link.submenu" :key="sub.label">
                <NuxtLink :to="sub.to">{{ sub.label }}</NuxtLink>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>

<style scoped lang="scss">
.top-bar {
  font-size: 14px;
  color: #333;

  &__container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 20px;
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
  }

  &__geo {
    flex-shrink: 0;
  }

  &__city-btn {
    background: none;
    border: none;
    padding: 4px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    color: #333;
    font-weight: 500;

    &:hover {
      text-decoration: underline;
    }
  }

  &__contacts {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 200px;
  }

  &__phones {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
  }

  &__phone {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #333;
    text-decoration: none;
    font-size: 13px;

    &:hover {
      text-decoration: underline;
    }

    &--unified {
      font-weight: 600;
      color: #e67e22;
    }
  }

  &__operator {
    font-size: 10px;
    background: #eee;
    padding: 2px 4px;
    border-radius: 2px;
    text-transform: uppercase;
  }

  &__schedule {
    font-size: 12px;
    color: #666;
  }

  &__label {
    color: #999;
    margin-right: 4px;
  }

  &__nav {
    margin-left: auto;
  }

  &__list {
    display: flex;
    gap: 16px;
    list-style: none;
    padding: 0;
    margin: 0;
    flex-wrap: wrap;
  }

  &__item {
    position: relative;

    &--highlight .top-bar__link {
      color: #e67e22;
      font-weight: 600;
    }

    &--submenu:hover .top-bar__submenu {
      display: block;
    }
  }

  &__link {
    text-decoration: none;
    color: #333;
    padding: 4px 0;
    display: inline-block;
    transition: color 0.2s;

    &:hover {
      color: #e67e22;
    }

    &--orange {
      color: #e67e22;
      font-weight: 600;
    }

    &--green {
      color: #27ae60;
      font-weight: 600;
    }
  }

  &__submenu {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    padding: 8px 0;
    min-width: 200px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);

    li a {
      display: block;
      padding: 8px 16px;
      color: #333;
      text-decoration: none;
      font-size: 13px;

      &:hover {
        background: #f5f5f5;
        color: #e67e22;
      }
    }
  }
}

// Адаптив
@media (max-width: 1024px) {
  .top-bar {
    &__container {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    &__nav {
      margin-left: 0;
      width: 100%;
    }

    &__list {
      gap: 12px 8px;
    }
  }
}
</style>