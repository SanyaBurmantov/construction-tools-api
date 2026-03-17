<script setup lang="ts">
const userActions = [
  { label: 'Избранное', to: '/favorites', icon: '❤️', counter: null },
  { label: 'Статус заказа', to: '#', icon: '🕐', modal: 'checkstatus' },
  { label: 'Войти', to: '/auth', icon: '👤', counter: 2, auth: true },
  { label: 'Корзина', to: '/cart', icon: '🛒', price: '0,00 р.', counter: 0 },
]
</script>

<template>
  <div class="main-header">
    <div class="main-header__container">
      <div class="main-header__logo">
        <NuxtLink to="/" class="main-header__logo-link">
          <span class="main-header__logo-text">Gost.By</span>
        </NuxtLink>
      </div>



      <div class="main-header__search">
        <form action="/search" method="GET" class="search-form">
          <input
            type="search"
            name="keys"
            placeholder="Поиск по каталогу"
            class="search-form__input"
          >
          <button type="submit" class="search-form__btn">🔍</button>
        </form>
      </div>

      <div class="main-header__actions">
        <div
          v-for="action in userActions"
          :key="action.label"
          class="main-header__action"
        >
          <NuxtLink :to="action.to" class="action-link">
            <span class="action-link__icon">{{ action.icon }}</span>
            <span class="action-link__text">{{ action.label }}</span>
            <span v-if="action.counter" class="action-link__counter">
              {{ action.counter }}
            </span>
            <span v-if="action.price" class="action-link__price">
              {{ action.price }}
            </span>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.main-header {
  &__container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 20px;
    display: flex;
    align-items: center;
    gap: 24px;
  }

  &__logo {
    flex-shrink: 0;
  }

  &__logo-link {
    text-decoration: none;
    font-size: 24px;
    font-weight: 700;
    color: #333;

    &:hover {
      color: #e67e22;
    }
  }


  &__search {
    flex: 1;
    max-width: 500px;
    min-width: 200px;
  }

  .search-form {
    display: flex;

    &__input {
      flex: 1;
      padding: 10px 14px;
      border: 2px solid #e5e5e5;
      border-right: none;
      border-radius: 4px 0 0 4px;
      font-size: 14px;
      outline: none;

      &:focus {
        border-color: #e67e22;
      }
    }

    &__btn {
      padding: 10px 16px;
      background: #e67e22;
      border: 2px solid #e67e22;
      border-left: none;
      border-radius: 0 4px 4px 0;
      color: #fff;
      cursor: pointer;
      font-size: 16px;
      transition: background 0.2s;

      &:hover {
        background: #d35400;
      }
    }
  }

  &__actions {
    display: flex;
    gap: 16px;
    flex-shrink: 0;
  }

  &__action {
    // стили для обертки
  }

  .action-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-decoration: none;
    color: #333;
    font-size: 12px;
    position: relative;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.2s;

    &:hover {
      background: #f5f5f5;
      color: #e67e22;
    }

    &__icon {
      font-size: 20px;
    }

    &__text {
      font-size: 11px;
      white-space: nowrap;
    }

    &__counter,
    &__price {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #e67e22;
      color: #fff;
      font-size: 10px;
      padding: 2px 5px;
      border-radius: 10px;
      min-width: 18px;
      text-align: center;
    }

    &__price {
      position: static;
      background: none;
      color: #e67e22;
      font-weight: 600;
      padding: 0;
    }
  }
}

// Адаптив
@media (max-width: 1024px) {
  .main-header {
    &__container {
      flex-wrap: wrap;
      gap: 16px;
    }

    &__search {
      order: 3;
      max-width: 100%;
      width: 100%;
    }

    &__actions {
      order: 4;
      width: 100%;
      justify-content: space-around;
    }
  }
}
</style>