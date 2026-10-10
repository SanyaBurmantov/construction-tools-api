<script setup lang="ts">
const props = defineProps<{
  slug: string
  productName: string
}>()

type Review = {
  id: string
  authorName: string
  rating: number
  title: string | null
  text: string
  createdAt: string
}

type ReviewsResponse = {
  data: Review[]
  summary: {
    average: number | null
    count: number
    distribution: Record<string, number>
  }
  pagination: { page: number, limit: number, total: number, pages: number }
}

const config = useRuntimeConfig()
const toast = useAppToast()

const page = ref(1)
const sort = ref<'createdAt' | 'rating'>('createdAt')

const { data, status } = await useAsyncData<ReviewsResponse>(
  () => `reviews-${props.slug}-${page.value}-${sort.value}`,
  () =>
    $fetch<ReviewsResponse>(
      `${import.meta.server ? config.apiBaseServer : config.public.apiBase}/products/${props.slug}/reviews`,
      { params: { page: page.value, limit: 5, sortBy: sort.value, sortOrder: 'desc' } }
    ),
  {
    watch: [page, sort],
    default: () => ({
      data: [],
      summary: { average: null, count: 0, distribution: {} },
      pagination: { page: 1, limit: 5, total: 0, pages: 0 },
    }),
  }
)

const summary = computed(() => data.value.summary)

/** Share of each star bucket, for the breakdown bars. */
function share(star: number) {
  const total = summary.value.count
  if (!total) return 0
  return Math.round(((summary.value.distribution[String(star)] ?? 0) / total) * 100)
}

const dateFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const formatDate = (iso: string) => dateFormatter.format(new Date(iso))

/* ---- Submission -------------------------------------------------------- */
const formOpen = ref(false)
const submitting = ref(false)
// `website` is the honeypot — hidden from real users, so anything in it came
// from a bot. Never shown, never validated, just forwarded to the API.
const form = reactive({
  authorName: '',
  authorEmail: '',
  rating: 5,
  title: '',
  text: '',
  website: '',
})
const errors = ref<Record<string, string>>({})

function validate() {
  const next: Record<string, string> = {}
  if (form.authorName.trim().length < 2) next.authorName = 'Укажите имя'
  if (form.text.trim().length < 10) next.text = 'Отзыв должен быть не короче 10 символов'
  if (form.authorEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.authorEmail)) {
    next.authorEmail = 'Некорректный email'
  }
  errors.value = next
  return Object.keys(next).length === 0
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    await $fetch(`${config.public.apiBase}/products/${props.slug}/reviews`, {
      method: 'POST',
      body: {
        authorName: form.authorName.trim(),
        authorEmail: form.authorEmail.trim() || undefined,
        rating: form.rating,
        title: form.title.trim() || undefined,
        text: form.text.trim(),
        website: form.website || undefined,
      },
    })
    formOpen.value = false
    Object.assign(form, {
      authorName: '',
      authorEmail: '',
      rating: 5,
      title: '',
      text: '',
      website: '',
    })
    toast.success('Отзыв отправлен на модерацию — он появится после проверки.')
  } catch (error) {
    const message
      = (error as { data?: { message?: string } }).data?.message
        || 'Не удалось отправить отзыв'
    toast.error(String(message))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section id="reviews" class="reviews">
    <header class="reviews-head">
      <h2>Отзывы<span v-if="summary.count"> · {{ summary.count }}</span></h2>
      <UiButton variant="secondary" size="sm" @click="formOpen = true">
        Написать отзыв
      </UiButton>
    </header>

    <div v-if="summary.count" class="summary">
      <div class="summary-score">
        <strong>{{ summary.average?.toFixed(1) }}</strong>
        <UiRating :value="summary.average" size="md" />
        <span>{{ pluralize(summary.count, 'review') }}</span>
      </div>

      <div class="summary-bars">
        <div v-for="star in [5, 4, 3, 2, 1]" :key="star" class="bar-row">
          <span class="bar-label">{{ star }}</span>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: `${share(star)}%` }" />
          </div>
          <span class="bar-count">{{ summary.distribution[String(star)] ?? 0 }}</span>
        </div>
      </div>
    </div>

    <div v-if="summary.count > 1" class="sort-row">
      <UiSelect
        v-model="sort"
        size="sm"
        :options="[
          { value: 'createdAt', label: 'Сначала новые' },
          { value: 'rating', label: 'Сначала с высокой оценкой' }
        ]"
      />
    </div>

    <div v-if="status === 'pending'" class="list">
      <UiSkeleton v-for="i in 3" :key="i" :lines="3" height="14px" />
    </div>

    <UiEmpty
      v-else-if="!data.data.length"
      icon="alert"
      title="Отзывов пока нет"
      :description="`Станьте первым, кто оценит «${productName}».`"
    >
      <UiButton size="sm" @click="formOpen = true">Написать отзыв</UiButton>
    </UiEmpty>

    <ul v-else class="list">
      <li v-for="review in data.data" :key="review.id" class="review">
        <div class="review-head">
          <div class="avatar" aria-hidden="true">{{ review.authorName.charAt(0) }}</div>
          <div>
            <strong>{{ review.authorName }}</strong>
            <time :datetime="review.createdAt">{{ formatDate(review.createdAt) }}</time>
          </div>
          <UiRating :value="review.rating" size="sm" />
        </div>
        <h3 v-if="review.title">{{ review.title }}</h3>
        <p>{{ review.text }}</p>
      </li>
    </ul>

    <UiPagination
      v-if="data.pagination.pages > 1"
      :page="data.pagination.page"
      :pages="data.pagination.pages"
      @change="page = $event"
    />

    <UiModal v-model:open="formOpen" title="Написать отзыв" size="md">
      <form class="review-form" @submit.prevent="submit">
        <UiField label="Ваша оценка" required>
          <UiRating v-model="form.rating" editable size="lg" />
        </UiField>

        <UiField label="Имя" required :error="errors.authorName" for="review-name">
          <UiInput id="review-name" v-model="form.authorName" placeholder="Как вас зовут" />
        </UiField>

        <UiField
          label="Email"
          hint="Не публикуется — нужен только для связи по отзыву."
          :error="errors.authorEmail"
          for="review-email"
        >
          <UiInput id="review-email" v-model="form.authorEmail" type="email" placeholder="you@example.com" />
        </UiField>

        <UiField label="Заголовок" for="review-title">
          <UiInput id="review-title" v-model="form.title" placeholder="Кратко о впечатлении" />
        </UiField>

        <UiField label="Отзыв" required :error="errors.text" for="review-text">
          <UiTextarea
            id="review-text"
            v-model="form.text"
            :rows="5"
            :maxlength="4000"
            placeholder="Что понравилось, что нет, для каких задач использовали"
          />
        </UiField>

        <!--
          Honeypot. Positioned off-screen rather than display:none, because
          many bots skip hidden inputs but do fill offscreen ones. Hidden from
          assistive tech and skipped by keyboard navigation.
        -->
        <div class="honeypot" aria-hidden="true">
          <label for="review-website">Не заполняйте это поле</label>
          <input
            id="review-website"
            v-model="form.website"
            type="text"
            tabindex="-1"
            autocomplete="off"
          >
        </div>

        <p class="disclaimer">
          Отзыв публикуется после проверки модератором.
        </p>
      </form>

      <template #footer>
        <UiButton variant="ghost" @click="formOpen = false">Отмена</UiButton>
        <UiButton :loading="submitting" @click="submit">Отправить</UiButton>
      </template>
    </UiModal>
  </section>
</template>

<style scoped>
.reviews {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.reviews-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.summary {
  display: grid;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-6);
  grid-template-columns: auto 1fr;
}

.summary-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-right: var(--space-6);
  border-right: 1px solid var(--border-subtle);
  gap: var(--space-1);
}

.summary-score strong {
  color: var(--text-strong);
  font-size: var(--text-4xl);
  font-weight: 800;
  line-height: 1;
}

.summary-score span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.summary-bars {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-2);
}

.bar-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.bar-label,
.bar-count {
  min-width: 20px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.bar-count {
  text-align: right;
}

.bar-track {
  flex: 1;
  height: 8px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
}

.bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--amber-400);
  transition: width var(--duration-slow) var(--ease-out);
}

.sort-row {
  display: flex;
  justify-content: flex-end;
}

.sort-row :deep(.ui-select) {
  width: 260px;
}

.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-4);
  list-style: none;
}

.review {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-2);
}

.review-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.review-head > div {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.review-head strong {
  color: var(--text-strong);
  font-size: var(--text-sm);
}

.review-head time {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.avatar {
  display: grid;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-full);
  background: var(--brand-soft);
  color: var(--brand-soft-text);
  font-weight: 800;
  place-items: center;
  text-transform: uppercase;
}

.review h3 {
  font-size: var(--text-md);
}

.review p {
  color: var(--text-default);
  white-space: pre-line;
}

.review-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.disclaimer {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* Off-screen rather than hidden — see the comment on the field itself. */
.honeypot {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

@media (max-width: 640px) {
  .summary {
    grid-template-columns: 1fr;
  }

  .summary-score {
    padding-right: 0;
    padding-bottom: var(--space-4);
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }
}
</style>
