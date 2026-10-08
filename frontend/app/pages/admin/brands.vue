<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type Brand = {
  id: string
  name: string
  slug: string
  description: string | null
  country: string | null
  logo: string | null
  seoTitle: string
  seoDescription: string
  _count?: { products: number }
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()

const brands = ref<Brand[]>([])
const loading = ref(false)
const loadError = ref('')
const search = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    brands.value = await adminFetch<Brand[]>('/brands')
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить бренды')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  const list = query
    ? brands.value.filter(
        (b) => b.name.toLowerCase().includes(query) || b.slug.toLowerCase().includes(query)
      )
    : brands.value
  return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
})

/* ---- Editor ------------------------------------------------------------ */
const editorOpen = ref(false)
const saving = ref(false)
const editing = ref<Brand | null>(null)
const formError = ref('')

const blankForm = () => ({
  name: '',
  slug: '',
  description: '',
  country: '',
  seoTitle: '',
  seoDescription: '',
})
const form = reactive(blankForm())

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)

function openCreate() {
  editing.value = null
  Object.assign(form, blankForm())
  formError.value = ''
  editorOpen.value = true
}

function openEdit(brand: Brand) {
  editing.value = brand
  Object.assign(form, {
    name: brand.name,
    slug: brand.slug,
    description: brand.description ?? '',
    country: brand.country ?? '',
    seoTitle: brand.seoTitle ?? '',
    seoDescription: brand.seoDescription ?? '',
  })
  formError.value = ''
  editorOpen.value = true
}

watch(() => form.name, (name) => {
  if (!editing.value) form.slug = slugify(name)
})

async function save() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Укажите название'
    return
  }
  if (!form.slug.trim()) {
    formError.value = 'Укажите slug'
    return
  }

  const body = {
    name: form.name.trim(),
    slug: form.slug.trim(),
    description: form.description.trim() || undefined,
    country: form.country.trim() || undefined,
    seoTitle: form.seoTitle.trim() || form.name.trim(),
    seoDescription: form.seoDescription.trim() || form.name.trim(),
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/brands/${editing.value.id}`, { method: 'PATCH', body })
      toast.success('Бренд сохранён')
    } else {
      await adminFetch('/brands', { method: 'POST', body })
      toast.success('Бренд создан')
    }
    editorOpen.value = false
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить бренд')
  } finally {
    saving.value = false
  }
}

/* ---- Merge & delete ---------------------------------------------------- */
const merging = ref<Brand | null>(null)
const mergeTarget = ref('')
const mergeBusy = ref(false)

async function confirmMerge() {
  if (!merging.value || !mergeTarget.value) return
  mergeBusy.value = true
  try {
    await adminFetch(`/brands/${merging.value.id}/merge`, {
      method: 'POST',
      body: { targetBrandId: mergeTarget.value },
    })
    toast.success('Бренды объединены')
    merging.value = null
    mergeTarget.value = ''
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось объединить бренды'))
  } finally {
    mergeBusy.value = false
  }
}

const deleting = ref<Brand | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await adminFetch(`/brands/${deleting.value.id}`, { method: 'DELETE' })
    toast.success('Бренд удалён')
    deleting.value = null
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить бренд'))
  } finally {
    deletingBusy.value = false
  }
}

const mergeOptions = computed(() =>
  filtered.value
    .filter((b) => b.id !== merging.value?.id)
    .map((b) => ({ value: b.id, label: b.name }))
)
</script>

<template>
  <div class="admin-brands">
    <header class="head">
      <div>
        <h1>Бренды</h1>
        <p>{{ brands.length }} брендов в каталоге</p>
      </div>
      <div class="head-actions">
        <UiInput v-model="search" placeholder="Найти бренд" size="sm" class="search" />
        <UiButton @click="openCreate">Добавить</UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div v-if="loading" class="skeleton">
      <UiSkeleton :lines="6" height="20px" />
    </div>

    <UiEmpty
      v-else-if="!filtered.length"
      icon="box"
      :title="search ? 'Ничего не найдено' : 'Брендов пока нет'"
      description="Бренды обычно заводятся парсерами вместе с товарами."
    >
      <UiButton @click="openCreate">Добавить бренд</UiButton>
    </UiEmpty>

    <ul v-else class="grid">
      <li v-for="brand in filtered" :key="brand.id" class="brand-card">
        <div class="brand-head">
          <div class="brand-logo">
            <img v-if="brand.logo" :src="brand.logo" :alt="brand.name" loading="lazy">
            <span v-else aria-hidden="true">{{ brand.name.charAt(0) }}</span>
          </div>
          <div class="brand-meta">
            <button type="button" class="brand-name" @click="openEdit(brand)">
              {{ brand.name }}
            </button>
            <code>/{{ brand.slug }}</code>
          </div>
        </div>

        <p v-if="brand.country" class="brand-country">{{ brand.country }}</p>
        <p v-if="brand._count" class="brand-count">{{ brand._count.products }} товаров</p>

        <div class="brand-actions">
          <UiButton variant="ghost" size="sm" @click="openEdit(brand)">Изменить</UiButton>
          <UiButton variant="ghost" size="sm" @click="merging = brand">Объединить</UiButton>
          <UiButton variant="ghost" size="sm" @click="deleting = brand">Удалить</UiButton>
        </div>
      </li>
    </ul>

    <UiModal
      v-model:open="editorOpen"
      :title="editing ? 'Редактирование бренда' : 'Новый бренд'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="form">
        <UiField label="Название" required for="b-name">
          <UiInput id="b-name" v-model="form.name" />
        </UiField>

        <UiField
          label="Slug"
          required
          :hint="editing ? 'Изменение сломает существующие ссылки на бренд' : undefined"
          for="b-slug"
        >
          <UiInput id="b-slug" v-model="form.slug" />
        </UiField>

        <UiField label="Страна" for="b-country">
          <UiInput id="b-country" v-model="form.country" placeholder="Тайвань" />
        </UiField>

        <UiField label="Описание" for="b-desc">
          <UiTextarea id="b-desc" v-model="form.description" :rows="3" />
        </UiField>

        <UiField label="SEO title" hint="Пусто — берётся название" for="b-seo-title">
          <UiInput id="b-seo-title" v-model="form.seoTitle" />
        </UiField>

        <UiField label="SEO description" for="b-seo-desc">
          <UiTextarea id="b-seo-desc" v-model="form.seoDescription" :rows="2" />
        </UiField>
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="Boolean(merging)"
      title="Объединить бренды"
      size="md"
      @update:open="merging = null"
    >
      <p class="confirm-text">
        Все товары бренда «{{ merging?.name }}» переедут к выбранному бренду,
        а «{{ merging?.name }}» будет удалён. Так чистятся дубли от разных поставщиков.
      </p>
      <UiField label="Целевой бренд" required for="b-merge">
        <UiSelect
          id="b-merge"
          v-model="mergeTarget"
          placeholder="Выберите бренд"
          :options="mergeOptions"
        />
      </UiField>

      <template #footer>
        <UiButton variant="ghost" @click="merging = null">Отмена</UiButton>
        <UiButton :loading="mergeBusy" :disabled="!mergeTarget" @click="confirmMerge">
          Объединить
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="Boolean(deleting)"
      title="Удалить бренд?"
      size="sm"
      @update:open="deleting = null"
    >
      <p class="confirm-text">
        «{{ deleting?.name }}» будет удалён. Если к нему привязаны товары,
        API отклонит удаление — сначала объедините бренд с другим.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleting = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-brands {
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

.head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.search {
  width: min(260px, 100%);
}

.skeleton {
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.grid {
  display: grid;
  padding: 0;
  margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
  list-style: none;
}

.brand-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-2);
}

.brand-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.brand-logo {
  display: grid;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-weight: 800;
  place-items: center;
}

.brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.brand-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.brand-name {
  color: var(--text-strong);
  font-weight: 700;
  text-align: left;
}

.brand-name:hover {
  color: var(--text-link);
}

.brand-meta code {
  color: var(--text-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.brand-country,
.brand-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.brand-actions {
  display: flex;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: var(--space-3);
  gap: var(--space-1);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-error {
  margin-bottom: var(--space-4);
}

.confirm-text {
  margin-bottom: var(--space-4);
  color: var(--text-muted);
}
</style>
