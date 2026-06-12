<script setup lang="ts">
const route = useRoute()

type Brand = {
  id: string
  name: string
  slug?: string
  _count?: {
    products: number
  }
}

const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const { data: brands, pending: brandsPending, error: brandsError } = await useAsyncData<Brand[]>(
  'brand-list',
  () => $fetch<Brand[]>(`${apiBase}/brands`).catch(() => []),
  { default: () => [] }
)

const sortedBrands = computed(() => {
  return [...(brands.value || [])].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
})

const filteredBrands = computed(() => {
  const rawQuery = Array.isArray(route.query.search) ? route.query.search[0] : route.query.search
  const query = String(rawQuery || '').trim().toLowerCase()

  if (!query) {
    return sortedBrands.value
  }

  return sortedBrands.value.filter(brand => brand.name.toLowerCase().includes(query))
})

const groupedBrands = computed(() => {
  return filteredBrands.value.reduce<Array<{ letter: string, items: Brand[] }>>((acc, brand) => {
    const letter = brand.name.trim().charAt(0).toUpperCase() || '#'
    const group = acc.at(-1)

    if (group?.letter === letter) {
      group.items.push(brand)
      return acc
    }

    acc.push({ letter, items: [brand] })
    return acc
  }, [])
})

function brandLink(brand: Brand) {
  return `/brand/${brand.slug || brand.id}/`
}

useHead({
  title: 'Бренды | Мультитул',
  meta: [
    {
      name: 'description',
      content: 'Список всех брендов в каталоге Мультитул с переходом к категориям каждого бренда.'
    }
  ]
})
</script>

<template>
  <div>
    <section class="brand-hero">
      <div>
        <span class="eyebrow">Бренды</span>
        <h1>Все бренды в каталоге</h1>
        <p>Выберите бренд, чтобы открыть страницу с его категориями и перейти к нужному разделу каталога.</p>
      </div>

      <div class="hero-meta">
        <strong>{{ sortedBrands.length }}</strong>
        <span>брендов доступно</span>
      </div>
    </section>

    <section class="brand-tools">
      <div class="tools-meta">
        <strong>{{ filteredBrands.length }}</strong>
        <span>{{ route.query.search ? 'найдено по запросу' : 'показано в списке' }}</span>
      </div>
    </section>

    <div v-if="brandsPending" class="state-card">Загружаем бренды...</div>
    <div v-else-if="brandsError" class="state-card error">Не удалось загрузить бренды: {{ brandsError.message }}</div>
    <div v-else-if="!sortedBrands.length" class="state-card">Бренды пока не найдены.</div>
    <div v-else-if="!filteredBrands.length" class="state-card">По вашему запросу бренды не найдены.</div>

    <div v-else class="brand-groups">
      <section v-for="group in groupedBrands" :key="group.letter" class="brand-group">
        <div class="group-head">
          <span>{{ group.letter }}</span>
          <small>{{ group.items.length }} брендов</small>
        </div>

        <div class="brands-grid">
          <NuxtLink
            v-for="brand in group.items"
            :key="brand.id"
            :to="brandLink(brand)"
            class="brand-card"
          >
            <div class="brand-card-glow" />

            <div class="brand-card-label">
              <span>Бренд</span>
              <strong>{{ group.letter }}</strong>
            </div>

            <div class="brand-card-top">
              <span class="brand-initial">{{ brand.name.charAt(0) }}</span>
              <div>
                <h2>{{ brand.name }}</h2>
                <small>Категории и подборка товаров</small>
              </div>
            </div>

            <p>
              Открыть страницу бренда, посмотреть все категории и перейти в каталог с нужными фильтрами.
            </p>

            <div class="brand-card-footer">
              <span>{{ brand._count?.products || 0 }} товаров</span>
              <i aria-hidden="true">↗</i>
            </div>
          </NuxtLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.brand-hero {
  display: grid;
  gap: 10px;
  align-items: end;
  border: 2px solid var(--color-ink);
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, rgba(243, 182, 31, 0.32), transparent 28%),
    linear-gradient(135deg, rgba(255, 250, 240, 0.98), rgba(243, 182, 31, 0.16));
  box-shadow: 7px 7px 0 var(--color-ink);
  margin-bottom: 14px;
  padding: clamp(14px, 2.4vw, 20px);

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  h1 {
    margin: 6px 0 8px;
    font-size: clamp(24px, 3.6vw, 38px);
    line-height: 0.98;
  }

  p {
    max-width: 640px;
    color: var(--color-muted);
    font-size: 14px;
    line-height: 1.45;
  }
}

.hero-meta {
  display: inline-grid;
  gap: 4px;
  min-width: 170px;
  padding: 18px 20px;
  border: 2px solid var(--color-ink);
  border-radius: 24px;
  background: rgba(255, 250, 240, 0.86);
  box-shadow: 6px 6px 0 var(--color-ink);

  strong {
    font-size: clamp(26px, 4vw, 40px);
    line-height: 1;
  }

  span {
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
}

.brand-tools {
  display: grid;
  justify-content: end;
  margin-bottom: 18px;
}

.tools-meta {
  display: inline-grid;
  gap: 4px;
  min-width: 170px;
  padding: 16px 18px;
  border: 2px solid var(--color-ink);
  border-radius: 22px;
  background: rgba(255, 250, 240, 0.92);
  box-shadow: 6px 6px 0 var(--color-ink);

  strong {
    font-size: 28px;
    line-height: 1;
  }

  span {
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
}

.brand-groups {
  display: grid;
  gap: 22px;
}

.brand-group {
  display: grid;
  gap: 14px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 12px;

  span {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 2px solid var(--color-ink);
    border-radius: 16px;
    background: var(--color-ink);
    color: var(--color-cream);
    font-family: var(--font-heading);
    font-size: 22px;
    box-shadow: 5px 5px 0 var(--color-accent);
  }

  small {
    color: var(--color-muted);
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
}

.eyebrow {
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.state-card {
  border: 2px solid var(--color-ink);
  border-radius: 28px;
  background: var(--color-card);
  box-shadow: 8px 8px 0 var(--color-ink);
  color: var(--color-muted);
  font-weight: 800;
  padding: 26px;
}

.state-card.error {
  color: var(--color-accent-strong);
}

.brands-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.brand-card {
  position: relative;
  overflow: hidden;
  display: grid;
  gap: 14px;
  align-content: start;
  border: 2px solid var(--color-ink);
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.65), transparent 42%),
    rgba(255, 250, 240, 0.95);
  box-shadow: 8px 8px 0 var(--color-ink);
  color: inherit;
  min-height: 230px;
  padding: 20px;
  text-decoration: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;

  h2 {
    font-size: 24px;
    margin: 0;
  }

  p {
    color: var(--color-muted);
    margin: 0;
    line-height: 1.6;
  }

  &:hover {
    transform: translate(-3px, -3px) rotate(-0.4deg);
    box-shadow: 12px 12px 0 var(--color-ink);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.8), transparent 42%),
      rgba(255, 248, 235, 0.98);
  }
}

.brand-card-glow {
  position: absolute;
  top: -26px;
  right: -18px;
  width: 104px;
  height: 104px;
  border-radius: 999px;
  background: rgba(243, 182, 31, 0.28);
  filter: blur(6px);
}

.brand-card-label {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  padding: 7px 10px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: rgba(255, 250, 240, 0.92);
  box-shadow: 4px 4px 0 var(--color-ink);

  span,
  strong {
    display: block;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  strong {
    color: var(--color-accent-strong);
  }
}

.brand-card-top {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;

  small {
    display: block;
    margin-top: 4px;
    color: var(--color-muted);
    font-size: 13px;
    font-weight: 700;
  }
}

.brand-initial {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border: 2px solid var(--color-ink);
  border-radius: 18px;
  background: var(--color-accent);
  box-shadow: 5px 5px 0 var(--color-ink);
  font-family: var(--font-heading);
  font-size: 22px;
  font-weight: 900;
  text-transform: uppercase;
}

.brand-card-footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed rgba(22, 28, 45, 0.22);

  span {
    color: var(--color-accent-strong);
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  i {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 2px solid var(--color-ink);
    border-radius: 12px;
    background: var(--color-ink);
    color: var(--color-cream);
    font-style: normal;
    font-size: 16px;
    box-shadow: 3px 3px 0 var(--color-accent);
  }
}
</style>
