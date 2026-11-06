<script setup lang="ts">
/**
 * A category's tile picture, three ways (owner, 2026-11-06: the borrowed
 * photo was sometimes wrong and could not be removed):
 *  - «Автоматически» — `''`: the photo of the category's typical product;
 *  - «Своя картинка» — a link or an upload into our bucket;
 *  - «Без картинки» — `'none'` (backend `categories/category-image.ts`):
 *    the letter plate, no borrowed photo.
 * The preview is the real storefront tile; for «Автоматически» it shows the
 * photo the storefront picks right now (`GET /categories/:slug`).
 */
const NO_IMAGE = 'none'

const model = defineModel<string>({ required: true })
const props = defineProps<{
  name: string
  slug?: string | null
  count?: number
  idPrefix?: string
}>()

type Mode = 'auto' | 'own' | 'none'
const modeOf = (value: string): Mode =>
  value === NO_IMAGE ? 'none' : value.trim() ? 'own' : 'auto'

const mode = ref<Mode>(modeOf(model.value))
/** The link typed or uploaded — kept while the mode is switched back and forth. */
const ownUrl = ref(mode.value === 'own' ? model.value : '')

watch(model, (value) => {
  const next = modeOf(value)
  if (next === 'own') ownUrl.value = value
  if (next !== mode.value && !(mode.value === 'own' && next === 'auto')) mode.value = next
})

watch([mode, ownUrl], ([current, url]) => {
  model.value = current === 'none' ? NO_IMAGE : current === 'own' ? url : ''
})

const options = [
  { value: 'auto' as const, label: 'Автоматически', hint: 'Фото типичного товара' },
  { value: 'own' as const, label: 'Своя картинка', hint: 'Ссылка или файл' },
  { value: 'none' as const, label: 'Без картинки', hint: 'Буква названия' },
]

/** What «Автоматически» shows on the storefront today. */
const { apiBase } = useSite()
const autoImage = ref<string | null>(null)
watch(
  () => props.slug,
  async (slug) => {
    autoImage.value = null
    if (!slug) return
    try {
      const category = await $fetch<{ image: string | null }>(
        `${apiBase}/categories/${encodeURIComponent(slug)}`
      )
      // With «Без картинки» or an own picture saved, the answer is not the
      // automatic photo — show it only when nothing was set by hand.
      if (modeOf(model.value) === 'auto') autoImage.value = category.image
    } catch {
      autoImage.value = null
    }
  },
  { immediate: true }
)

const previewImage = computed(() =>
  mode.value === 'own' ? ownUrl.value.trim() || null : mode.value === 'auto' ? autoImage.value : null
)
const id = (part: string) => `${props.idPrefix ?? 'cat-img'}-${part}`
</script>

<template>
  <div class="category-image-field">
    <UiRadioCards v-model="mode" :options="options" legend="Картинка категории" />

    <div v-if="mode === 'own'" class="admin-input-upload">
      <UiInput :id="id('url')" v-model="ownUrl" placeholder="https://…" />
      <AdminImageUpload @uploaded="ownUrl = $event" />
      <UiButton
        v-if="ownUrl.trim()"
        variant="ghost"
        icon-only
        aria-label="Удалить картинку"
        title="Удалить картинку"
        @click="ownUrl = ''; mode = 'auto'"
      >
        <UiIcon name="trash" :size="18" :stroke-width="1.8" />
      </UiButton>
    </div>

    <div class="preview">
      <span class="preview-label">
        Так плитка выглядит в каталоге<template v-if="mode === 'auto' && !autoImage">: подходящего фото пока нет — будет буква</template>
      </span>
      <div class="tile">
        <UiCategoryCard :name="name || 'Категория'" to="#" :image="previewImage" :count="count ?? 0" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.category-image-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.preview-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.tile {
  width: 200px;
}
</style>
