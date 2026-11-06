<script setup lang="ts">
/**
 * «Загрузить» beside an image-link field: the picked file goes to our S3
 * (`POST /admin/media/upload`, resized there) and the answer is the URL the
 * field stores — the same field still takes a pasted link. `kind="banner"`
 * keeps one wide WebP; anything else is cut into the photo sizes, so the
 * storefront picks the size it draws (utils/media-variants.ts).
 */
const props = withDefaults(defineProps<{ kind?: 'image' | 'banner' }>(), { kind: 'image' })
const emit = defineEmits<{ uploaded: [url: string] }>()

const { adminFetch } = useAdminApi()
const toast = useAppToast()
const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)

async function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  if (file.size > 15 * 1024 * 1024) {
    toast.push('Файл больше 15 МБ', { tone: 'danger' })
    return
  }
  const body = new FormData()
  body.append('file', file)
  busy.value = true
  try {
    const { url } = await adminFetch<{ url: string }>(`/media/upload?kind=${props.kind}`, { method: 'POST', body })
    emit('uploaded', url)
    toast.push('Картинка загружена в наше хранилище', { tone: 'success' })
  }
  catch (error) {
    const data = (error as { data?: { message?: string | string[] } }).data
    const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message
    toast.push(message || 'Не удалось загрузить картинку', { tone: 'danger' })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <span class="image-upload">
    <input
      ref="input"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      hidden
      @change="onPick"
    >
    <UiButton variant="secondary" :loading="busy" @click="input?.click()">
      <template #leading><UiIcon name="upload" :size="16" /></template>
      Загрузить
    </UiButton>
  </span>
</template>

<style scoped>
.image-upload {
  display: inline-flex;
  flex: none;
}
</style>
