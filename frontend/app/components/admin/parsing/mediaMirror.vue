<script setup lang="ts">
import type { MediaMirrorStats } from '~/types/parsing'

/**
 * «Фото в нашем хранилище» — how far the worker has copied supplier photos
 * into S3 (backend media/image-mirror.service.ts). Read-only: the copying runs
 * on its own; a photo it could not fetch is retried with backoff.
 */
const props = defineProps<{
  stats: MediaMirrorStats | null
  loading: boolean
}>()

defineEmits<{ reload: [] }>()

const share = computed(() => {
  const s = props.stats
  if (!s || !s.images) return '—'
  return `${Math.floor((s.servedFromOurStorage / s.images) * 100)}%`
})

function gb(bytes: number | null | undefined): string {
  return bytes == null ? '—' : `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
}
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Фото в нашем хранилище</h2>
        <p v-if="stats && !stats.enabled">
          Выключено: в окружении нет ключей S3 или S3_MEDIA_BUCKET — фото берутся с сайтов поставщиков.
        </p>
        <p v-else>
          Воркер сам копирует фото поставщиков в S3{{ stats?.bucket ? ` (${stats.bucket})` : '' }},
          и витрина показывает нашу копию. Сначала опубликованные товары.
        </p>
      </div>
    </template>
    <template #actions>
      <UiButton variant="secondary" size="sm" :loading="loading" @click="$emit('reload')">
        Обновить
      </UiButton>
    </template>

    <div class="stat-row pad">
      <div class="stat">
        <strong>{{ share }}</strong><span>фото с нашего хранилища</span>
      </div>
      <div class="stat">
        <strong>{{ stats?.servedFromOurStorage ?? '—' }}</strong><span>из {{ stats?.images ?? '—' }} фото</span>
      </div>
      <div class="stat">
        <strong>{{ gb(stats?.storedBytes) }}</strong><span>занято из {{ gb(stats?.maxBytes) }}</span>
      </div>
      <div class="stat" :class="{ 'is-danger': (stats?.failedPhotos ?? 0) > 0 }">
        <strong>{{ stats?.failedPhotos ?? '—' }}</strong><span>не скачались (повтор позже)</span>
      </div>
    </div>
    <p v-if="stats?.failedByHost.length" class="hosts pad">
      Не скачались по сайтам:
      <span v-for="row in stats.failedByHost" :key="row.host">{{ row.host }} — {{ row.count }}</span>
    </p>
  </UiCard>
</template>

<style scoped>
.hosts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  padding-top: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
