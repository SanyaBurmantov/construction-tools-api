<script setup lang="ts">
// Пустые категории, которые потом будут парситься
const categories = ref([
  { label: 'Электроника', to: '', children: [] },
  { label: 'Бытовая техника', to: '', children: [] },
  { label: 'Мебель', to: '', children: [] },
  { label: 'Одежда', to: '', children: [] },
  { label: 'Дом и сад', to: '', children: [] },
  { label: 'Авто', to: '', children: [] },
  { label: 'Спорт', to: '', children: [] },
  { label: 'Детям', to: '', children: [] },
  { label: 'Красота', to: '', children: [] },
])

// Заглушка для подкатегорий (будет заполняться после парсинга)
const placeholderSubcategories = [
  'Подкатегория 1',
  'Подкатегория 2',
  'Подкатегория 3',
  'Подкатегория 4',
]
</script>

<template>
  <nav class="catalog-nav">
    <div class="catalog-nav__container">
      <ul class="catalog-nav__list">
        <li
          v-for="category in categories"
          :key="category.label"
          class="catalog-nav__item"
          :class="{ 'catalog-nav__item--dropdown': category.isDropdown }"
        >
          <NuxtLink
            :to="category.to"
            class="catalog-nav__link"
          >
            {{ category.label }}
          </NuxtLink>

          <!-- Заглушка подменю -->
          <ul v-if="category.isDropdown || category.children?.length" class="catalog-nav__submenu">
            <li v-if="category.children?.length">
              <NuxtLink
                v-for="child in category.children"
                :key="child.label"
                :to="child.to"
              >
                {{ child.label }}
              </NuxtLink>
            </li>
            <li v-else>
              <!-- Пустые заглушки, пока нет данных -->
              <NuxtLink
                v-for="i in 4"
                :key="i"
                :to="`/catalog/placeholder-${i}`"
                class="catalog-nav__placeholder"
              >
                Загрузка...
              </NuxtLink>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.catalog-nav {
  font-size: 14px;

  &__container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 20px;
  }

  &__list {
    display: flex;
    gap: 4px;
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-x: auto;
    scrollbar-width: thin;

    &::-webkit-scrollbar {
      height: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 2px;
    }
  }

  &__item {
    flex-shrink: 0;
    position: relative;

    &:hover .catalog-nav__submenu {
      display: block;
    }

    &--dropdown .catalog-nav__link::after {
      content: ' ▼';
      font-size: 8px;
      vertical-align: middle;
    }
  }

  &__link {
    display: block;
    padding: 8px 12px;
    color: #333;
    text-decoration: none;
    white-space: nowrap;
    border-radius: 4px;
    transition: all 0.2s;

    &:hover {
      background: #e67e22;
      color: #fff;
    }
  }

  &__submenu {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 0 0 4px 4px;
    padding: 8px 0;
    min-width: 220px;
    z-index: 90;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);

    li {
      padding: 0;
    }

    a {
      display: block;
      padding: 8px 16px;
      color: #333;
      text-decoration: none;
      font-size: 13px;
      transition: background 0.2s;

      &:hover {
        background: #f5f5f5;
        color: #e67e22;
      }
    }
  }

  &__placeholder {
    color: #999 !important;
    font-style: italic;
    cursor: default;

    &:hover {
      background: #fafafa !important;
      color: #999 !important;
    }
  }
}
</style>