<script setup lang="ts">
import type { AdminBanner } from '~/types/api'

definePageMeta({ layout: 'admin' })

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { run, busy } = useAdminAction()

const banners = ref<AdminBanner[]>([])
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    banners.value = await adminFetch<AdminBanner[]>('/banners')
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить баннеры')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/* ---- Editor ------------------------------------------------------------- */
const editorOpen = ref(false)
const editing = ref<AdminBanner | null>(null)
const saving = ref(false)
const formError = ref('')

const blankForm = () => ({
  title: '',
  subtitle: '',
  imageUrl: '',
  mobileUrl: '',
  linkUrl: '',
  buttonText: '',
  bgColor: '',
  order: 0 as number | null,
  isActive: true,
  startsAt: '',
  endsAt: '',
})
const form = reactive(blankForm())

function openCreate() {
  editing.value = null
  Object.assign(form, blankForm())
  form.order = banners.value.length
  formError.value = ''
  editorOpen.value = true
}

function openEdit(banner: AdminBanner) {
  editing.value = banner
  Object.assign(form, {
    ...blankForm(),
    title: banner.title,
    subtitle: banner.subtitle ?? '',
    imageUrl: banner.imageUrl,
    mobileUrl: banner.mobileUrl ?? '',
    linkUrl: banner.linkUrl ?? '',
    buttonText: banner.buttonText ?? '',
    bgColor: banner.bgColor ?? '',
    order: banner.order,
    isActive: banner.isActive,
    startsAt: toLocalInput(banner.startsAt),
    endsAt: toLocalInput(banner.endsAt),
  })
  formError.value = ''
  editorOpen.value = true
}

async function save() {
  formError.value = ''
  if (!form.title.trim()) {
    formError.value = 'Укажите заголовок'
    return
  }
  if (!form.imageUrl.trim()) {
    formError.value = 'Укажите ссылку на изображение'
    return
  }

  // A cleared field goes as `null`: `undefined` is dropped from the JSON, and
  // the update merges an absent field with the stored value, so an emptied
  // subtitle or end date used to come back on save.
  const body = {
    title: form.title.trim(),
    subtitle: textOrNull(form.subtitle),
    imageUrl: form.imageUrl.trim(),
    mobileUrl: textOrNull(form.mobileUrl),
    linkUrl: textOrNull(form.linkUrl),
    buttonText: textOrNull(form.buttonText),
    bgColor: textOrNull(form.bgColor),
    order: numOrNull(form.order) ?? 0,
    isActive: form.isActive,
    startsAt: fromLocalInput(form.startsAt),
    endsAt: fromLocalInput(form.endsAt),
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/banners/${editing.value.id}`, { method: 'PATCH', body })
      toast.success('Баннер сохранён')
    } else {
      await adminFetch('/banners', { method: 'POST', body })
      toast.success('Баннер создан')
    }
    editorOpen.value = false
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить баннер')
  } finally {
    saving.value = false
  }
}

const toggleActive = (banner: AdminBanner) =>
  run(
    () => adminFetch(`/banners/${banner.id}`, {
      method: 'PATCH',
      body: { isActive: !banner.isActive },
    }),
    { key: `toggle-${banner.id}`, error: 'Не удалось изменить статус', after: load },
  )

/**
 * Swaps `order` with the neighbour, so the slider sequence is editable. There
 * is no bulk order endpoint for banners, so it is two PATCHes; when the second
 * fails the first has already landed, and the list is reloaded either way so
 * the screen shows the order the database actually has.
 */
async function move(banner: AdminBanner, direction: -1 | 1) {
  const sorted = [...banners.value].sort((a, b) => a.order - b.order)
  const index = sorted.findIndex(b => b.id === banner.id)
  const neighbour = sorted[index + direction]
  if (!neighbour) return

  await run(
    async () => {
      await adminFetch(`/banners/${banner.id}`, {
        method: 'PATCH',
        body: { order: neighbour.order },
      })
      await adminFetch(`/banners/${neighbour.id}`, {
        method: 'PATCH',
        body: { order: banner.order },
      })
    },
    { key: 'move', error: 'Не удалось изменить порядок' },
  )
  await load()
}

const deleting = ref<AdminBanner | null>(null)

async function confirmDelete() {
  const banner = deleting.value
  if (!banner) return
  const done = await run(() => adminFetch(`/banners/${banner.id}`, { method: 'DELETE' }), {
    key: 'delete',
    error: 'Не удалось удалить баннер',
    success: 'Баннер удалён',
    after: load,
  })
  if (done !== undefined) deleting.value = null
}

/** Why a banner isn't on the site right now, or null when it is. */
function hiddenReason(banner: AdminBanner) {
  if (!banner.isActive) return 'Выключен'
  const now = Date.now()
  if (banner.startsAt && new Date(banner.startsAt).getTime() > now) return 'Ещё не начался'
  if (banner.endsAt && new Date(banner.endsAt).getTime() < now) return 'Истёк'
  return null
}
</script>

<template>
  <div class="admin-page">
    <AdminPageHead title="Баннеры" description="Слайдер в первом экране главной страницы">
      <UiButton @click="openCreate">Добавить баннер</UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiAlert tone="info">
      Загрузки файлов в проекте нет — изображение указывается ссылкой. Подойдёт
      любой доступный по URL файл. Рекомендуемый размер: 1200×400, для мобильных
      можно отдельную картинку 800×600.
    </UiAlert>

    <div v-if="loading" class="list">
      <UiSkeleton v-for="i in 2" :key="i" height="140px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!banners.length"
      icon="box"
      title="Баннеров пока нет"
      description="Слайдер не показывается, пока нет ни одного активного баннера — главная просто начинается с поиска."
    >
      <UiButton @click="openCreate">Добавить баннер</UiButton>
    </UiEmpty>

    <ul v-else class="list">
      <li
        v-for="(banner, index) in banners"
        :key="banner.id"
        class="banner"
        :class="{ 'is-hidden': hiddenReason(banner) }"
      >
        <div class="preview">
          <img :src="banner.imageUrl" :alt="banner.title" loading="lazy">
        </div>

        <div class="info">
          <div class="info-head">
            <button type="button" class="title" @click="openEdit(banner)">
              {{ banner.title }}
            </button>
            <UiBadge :tone="hiddenReason(banner) ? 'neutral' : 'success'" size="sm">
              {{ hiddenReason(banner) || 'Показывается' }}
            </UiBadge>
          </div>

          <p v-if="banner.subtitle" class="subtitle">{{ banner.subtitle }}</p>

          <dl class="facts">
            <div v-if="banner.linkUrl">
              <dt>Ссылка</dt>
              <dd><code>{{ banner.linkUrl }}</code></dd>
            </div>
            <div v-if="banner.startsAt || banner.endsAt">
              <dt>Период</dt>
              <dd>{{ formatDateTime(banner.startsAt) }} — {{ formatDateTime(banner.endsAt) }}</dd>
            </div>
          </dl>
        </div>

        <div class="actions">
          <div class="order">
            <button
              type="button"
              :disabled="index === 0 || Boolean(busy)"
              aria-label="Выше"
              @click="move(banner, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              :disabled="index === banners.length - 1 || Boolean(busy)"
              aria-label="Ниже"
              @click="move(banner, 1)"
            >
              ↓
            </button>
          </div>
          <UiButton variant="ghost" size="sm" @click="openEdit(banner)">Изменить</UiButton>
          <UiButton
            variant="ghost"
            size="sm"
            :loading="busy === `toggle-${banner.id}`"
            @click="toggleActive(banner)"
          >
            {{ banner.isActive ? 'Выключить' : 'Включить' }}
          </UiButton>
          <UiButton variant="ghost" size="sm" @click="deleting = banner">Удалить</UiButton>
        </div>
      </li>
    </ul>

    <UiModal
      v-model:open="editorOpen"
      :title="editing ? 'Редактирование баннера' : 'Новый баннер'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="admin-form">
        <UiField label="Заголовок" required for="b-title">
          <UiInput id="b-title" v-model="form.title" placeholder="Скидки на электроинструмент" />
        </UiField>

        <UiField label="Подзаголовок" for="b-sub">
          <UiInput id="b-sub" v-model="form.subtitle" placeholder="До конца месяца" />
        </UiField>

        <UiField label="Изображение, ссылка" required hint="1200×400" for="b-img">
          <UiInput id="b-img" v-model="form.imageUrl" placeholder="https://…/banner.jpg" />
        </UiField>

        <div v-if="form.imageUrl" class="form-preview">
          <img :src="form.imageUrl" alt="Предпросмотр баннера">
        </div>

        <UiField label="Изображение для мобильных" hint="Необязательно, 800×600" for="b-mob">
          <UiInput id="b-mob" v-model="form.mobileUrl" placeholder="https://…/banner-mobile.jpg" />
        </UiField>

        <div class="admin-form-row">
          <UiField label="Ссылка при клике" for="b-link">
            <UiInput id="b-link" v-model="form.linkUrl" placeholder="/sales" />
          </UiField>
          <UiField label="Текст кнопки" for="b-btn">
            <UiInput id="b-btn" v-model="form.buttonText" placeholder="Смотреть акции" />
          </UiField>
        </div>

        <div class="admin-form-row">
          <UiField label="Цвет фона" hint="Если картинка не закрывает всю область" for="b-bg">
            <UiInput id="b-bg" v-model="form.bgColor" placeholder="#0f172a" />
          </UiField>
          <UiField label="Порядок" hint="Меньше — раньше" for="b-order">
            <UiInput id="b-order" v-model="form.order" type="number" />
          </UiField>
        </div>

        <div class="admin-form-row">
          <UiField label="Показывать с" for="b-start">
            <UiInput id="b-start" v-model="form.startsAt" type="datetime-local" />
          </UiField>
          <UiField label="Показывать до" for="b-end">
            <UiInput id="b-end" v-model="form.endsAt" type="datetime-local" />
          </UiField>
        </div>

        <UiCheckbox v-model="form.isActive" label="Баннер активен" />
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <UiConfirm
      :open="Boolean(deleting)"
      title="Удалить баннер?"
      :busy="busy === 'delete'"
      @update:open="deleting = null"
      @confirm="confirmDelete"
    >
      «{{ deleting?.title }}» будет удалён безвозвратно.
    </UiConfirm>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.banner {
  display: grid;
  align-items: start;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-4);
  grid-template-columns: 220px minmax(0, 1fr) auto;
}

.banner.is-hidden {
  opacity: 0.6;
}

.preview {
  aspect-ratio: 3 / 1;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.info-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.title {
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 700;
}

.title:hover {
  color: var(--text-link);
}

.subtitle {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.facts {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-1);
}

.facts > div {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-xs);
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  overflow: hidden;
  margin: 0;
  color: var(--text-default);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facts code {
  font-family: var(--font-mono);
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
}

.order {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-1);
  gap: var(--space-1);
}

.order button {
  width: 32px;
  height: 28px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  color: var(--text-muted);
}

.order button:hover:not(:disabled) {
  border-color: var(--brand);
  color: var(--brand);
}

.order button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.form-preview {
  aspect-ratio: 3 / 1;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.form-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.form-error {
  margin-bottom: var(--space-4);
}

@media (max-width: 900px) {
  .banner {
    grid-template-columns: 1fr;
  }

  .actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
