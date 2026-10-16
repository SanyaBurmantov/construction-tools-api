<script setup lang="ts">
import type { Paginated } from '~/types/api'
import { formatDateTimeWithYear as formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/** The moderation projection — the public `Review` carries neither e-mail nor product. */
type AdminReview = {
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

type ListResponse = Paginated<AdminReview> & { pendingCount: number }

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const tab = ref<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING')
const search = ref('')
const pendingCount = ref(0)

const { rows: reviews, pagination, loading, error: loadError, load, setPage } = useAdminList<
  AdminReview,
  ListResponse
>('/reviews', {
  params: () => ({ status: tab.value, search: search.value }),
  debounce: 350,
  errorText: 'Не удалось загрузить отзывы',
  onResponse: (response) => {
    pendingCount.value = response.pendingCount
  },
})

const setStatus = (review: AdminReview, status: AdminReview['status']) =>
  run(() => adminFetch(`/reviews/${review.id}/status`, { method: 'PATCH', body: { status } }), {
    key: review.id,
    error: 'Не удалось изменить статус',
    success: status === 'APPROVED' ? 'Отзыв опубликован' : 'Отзыв отклонён',
    after: load,
  })

const deleting = ref<AdminReview | null>(null)

async function confirmDelete() {
  const review = deleting.value
  if (!review) return
  const done = await run(() => adminFetch(`/reviews/${review.id}`, { method: 'DELETE' }), {
    key: 'delete',
    error: 'Не удалось удалить отзыв',
    success: 'Отзыв удалён',
    after: load,
  })
  if (done !== undefined) deleting.value = null
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
</script>

<template>
  <div class="admin-page">
    <AdminPageHead title="Отзывы" description="Каждый отзыв публикуется только после проверки">
      <UiInput
        v-model="search"
        placeholder="Автор или текст"
        aria-label="Поиск отзывов"
        size="sm"
        class="search"
      />
    </AdminPageHead>

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
            <time :datetime="review.createdAt">{{ formatDateTime(review.createdAt) }}</time>
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
              :loading="busy === review.id"
              @click="setStatus(review, 'APPROVED')"
            >
              Опубликовать
            </UiButton>
            <UiButton
              v-if="review.status !== 'REJECTED'"
              size="sm"
              variant="secondary"
              :loading="busy === review.id"
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
      @change="setPage"
    />

    <UiConfirm
      :open="Boolean(deleting)"
      title="Удалить отзыв?"
      :busy="busy === 'delete'"
      @update:open="deleting = null"
      @confirm="confirmDelete"
    >
      Отзыв от «{{ deleting?.authorName }}» будет удалён безвозвратно, рейтинг товара
      пересчитается.
    </UiConfirm>
  </div>
</template>

<style scoped>
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
