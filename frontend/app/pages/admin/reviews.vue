<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type Review = {
  id: string
  productId: string
  authorName: string
  authorEmail: string | null
  rating: number
  title: string | null
  text: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  moderatedAt: string | null
  createdAt: string
  product: {
    id: string
    name: string
    slug: string
    images: Array<{ url: string }>
  }
}

type ListResponse = {
  data: Review[]
  pendingCount: number
  pagination: { page: number, limit: number, total: number, pages: number }
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const reviews = ref<Review[]>([])
const pendingCount = ref(0)
const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 })
const loading = ref(false)
const loadError = ref('')
const busyId = ref('')

const tab = ref<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING')
const search = ref('')
const page = ref(1)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<ListResponse>('/reviews', {
      params: {
        page: page.value,
        limit: 20,
        ...(tab.value ? { status: tab.value } : {}),
        ...(search.value.trim() ? { search: search.value.trim() } : {}),
      },
    })
    reviews.value = response.data
    pendingCount.value = response.pendingCount
    pagination.value = response.pagination
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить отзывы')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(tab, () => {
  page.value = 1
  void load()
})
watch(page, () => void load())

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void load()
  }, 350)
})

async function setStatus(review: Review, status: Review['status']) {
  busyId.value = review.id
  try {
    await adminFetch(`/reviews/${review.id}/status`, { method: 'PATCH', body: { status } })
    toast.success(status === 'APPROVED' ? 'Отзыв опубликован' : 'Отзыв отклонён')
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось изменить статус'))
  } finally {
    busyId.value = ''
  }
}

const deleting = ref<Review | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await adminFetch(`/reviews/${deleting.value.id}`, { method: 'DELETE' })
    toast.success('Отзыв удалён')
    deleting.value = null
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить отзыв'))
  } finally {
    deletingBusy.value = false
  }
}

const STATUS_TONES = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
} as const
const STATUS_LABELS = {
  PENDING: 'На модерации',
  APPROVED: 'Опубликован',
  REJECTED: 'Отклонён',
} as const

const dateFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const formatDate = (iso: string) => dateFormatter.format(new Date(iso))
</script>

<template>
  <div class="admin-reviews">
    <header class="head">
      <div>
        <h1>Отзывы</h1>
        <p>Каждый отзыв публикуется только после проверки</p>
      </div>
      <UiInput v-model="search" placeholder="Автор или текст" size="sm" class="search" />
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiTabs
      v-model="tab"
      :tabs="[
        { value: 'PENDING', label: 'На модерации', count: pendingCount },
        { value: 'APPROVED', label: 'Опубликованные' },
        { value: 'REJECTED', label: 'Отклонённые' },
        { value: '', label: 'Все' }
      ]"
    />

    <div v-if="loading" class="list">
      <UiSkeleton v-for="i in 3" :key="i" height="140px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!reviews.length"
      icon="star"
      :title="tab === 'PENDING' ? 'Новых отзывов нет' : 'Отзывы не найдены'"
      description="Здесь появятся отзывы, оставленные покупателями на страницах товаров."
    />

    <ul v-else class="list">
      <li v-for="review in reviews" :key="review.id" class="review">
        <div class="review-main">
          <div class="review-head">
            <UiRating :value="review.rating" size="sm" />
            <UiBadge :tone="STATUS_TONES[review.status]" size="sm">
              {{ STATUS_LABELS[review.status] }}
            </UiBadge>
            <time :datetime="review.createdAt">{{ formatDate(review.createdAt) }}</time>
          </div>

          <h3 v-if="review.title">{{ review.title }}</h3>
          <p class="review-text">{{ review.text }}</p>

          <div class="review-meta">
            <span><strong>{{ review.authorName }}</strong></span>
            <span v-if="review.authorEmail">{{ review.authorEmail }}</span>
          </div>
        </div>

        <div class="review-side">
          <NuxtLink :to="`/product/${review.product.slug}`" target="_blank" class="product">
            <img
              v-if="review.product.images?.length"
              :src="review.product.images[0]!.url"
              :alt="review.product.name"
              loading="lazy"
            >
            <span v-else class="product-thumb" aria-hidden="true" />
            <span>{{ review.product.name }}</span>
          </NuxtLink>

          <div class="review-actions">
            <UiButton
              v-if="review.status !== 'APPROVED'"
              size="sm"
              variant="success"
              :loading="busyId === review.id"
              @click="setStatus(review, 'APPROVED')"
            >
              Опубликовать
            </UiButton>
            <UiButton
              v-if="review.status !== 'REJECTED'"
              size="sm"
              variant="secondary"
              :loading="busyId === review.id"
              @click="setStatus(review, 'REJECTED')"
            >
              Отклонить
            </UiButton>
            <UiButton size="sm" variant="ghost" @click="deleting = review">Удалить</UiButton>
          </div>
        </div>
      </li>
    </ul>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="page = $event"
    />

    <UiModal
      :open="Boolean(deleting)"
      title="Удалить отзыв?"
      size="sm"
      @update:open="deleting = null"
    >
      <p class="confirm-text">
        Отзыв от «{{ deleting?.authorName }}» будет удалён безвозвратно, рейтинг товара
        пересчитается.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleting = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-reviews {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.search {
  width: min(280px, 100%);
}

.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.review {
  display: grid;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-5);
  grid-template-columns: 1fr 280px;
}

.review-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.review-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.review-head time {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.review h3 {
  font-size: var(--text-md);
}

.review-text {
  color: var(--text-default);
  font-size: var(--text-sm);
  white-space: pre-line;
}

.review-meta {
  display: flex;
  flex-wrap: wrap;
  color: var(--text-muted);
  font-size: var(--text-xs);
  gap: var(--space-3);
}

.review-side {
  display: flex;
  flex-direction: column;
  padding-left: var(--space-5);
  border-left: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

.product {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-default);
  font-size: var(--text-xs);
}

.product:hover {
  color: var(--text-link);
}

.product img,
.product-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.review-actions {
  display: flex;
  flex-direction: column;
  margin-top: auto;
  gap: var(--space-2);
}

.confirm-text {
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .review {
    grid-template-columns: 1fr;
  }

  .review-side {
    padding-left: 0;
    padding-top: var(--space-4);
    border-left: 0;
    border-top: 1px solid var(--border-subtle);
  }

  .review-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
