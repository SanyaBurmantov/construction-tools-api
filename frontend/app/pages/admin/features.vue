<script setup lang="ts">
/**
 * «Фичи»: feature flags and kill switches (backend `features/`). A new
 * feature is switched to «Только админам», tried on the real site, then «Всем»;
 * a block that misbehaves is switched off without a rollback. The storefront
 * reads the flags client-side, so a change shows on the next page load — the
 * cached HTML is never the problem.
 */
definePageMeta({ layout: 'admin' })

type Flag = {
  key: string
  name: string
  description: string
  default: FeatureMode
  mode: FeatureMode
}

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const flags = ref<Flag[]>([])
const loading = ref(true)
const loadError = ref('')

const modeOptions = [
  { value: 'off', label: 'Выключено' },
  { value: 'admins', label: 'Только админам' },
  { value: 'on', label: 'Всем' },
]
const modeLabel = (mode: FeatureMode) => modeOptions.find(option => option.value === mode)?.label ?? mode

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    flags.value = await adminFetch<Flag[]>('/features')
  } catch {
    loadError.value = 'Не удалось загрузить флаги'
  } finally {
    loading.value = false
  }
}

async function setMode(flag: Flag, mode: FeatureMode) {
  if (mode === flag.mode) return
  await run(() => adminFetch<Flag[]>(`/features/${flag.key}`, { method: 'PUT', body: { mode } }), {
    error: 'Не удалось переключить',
    success: `«${flag.name}»: ${modeLabel(mode).toLowerCase()}`,
    after: (list) => {
      flags.value = list
    },
  })
}

onMounted(load)
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Фичи"
      description="Включение новых возможностей и аварийные выключатели. Новое сначала включают «Только админам» и проверяют на живом сайте, потом — «Всем»; если блок начал вести себя странно, его выключают здесь, без отката релиза. Витрина подхватывает изменение при следующей загрузке страницы."
    >
      <UiButton variant="secondary" size="sm" :loading="loading" @click="load">Обновить</UiButton>
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="loading && !flags.length" height="200px" radius="var(--radius-md)" />

    <UiCard v-for="flag in flags" :key="flag.key">
      <div class="flag">
        <div>
          <h2 class="flag-name">{{ flag.name }}</h2>
          <p class="admin-muted">{{ flag.description }}</p>
          <p class="admin-muted hint">
            <code>{{ flag.key }}</code> · по умолчанию: {{ modeLabel(flag.default).toLowerCase() }}
          </p>
        </div>
        <UiSelect
          :model-value="flag.mode"
          size="sm"
          :options="modeOptions"
          :disabled="Boolean(busy)"
          :aria-label="`Режим: ${flag.name}`"
          @update:model-value="(mode) => setMode(flag, mode as FeatureMode)"
        />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.flag {
  display: grid;
  grid-template-columns: 1fr 200px;
  gap: var(--space-4);
  align-items: start;
}

.flag-name {
  margin-bottom: var(--space-1);
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 600;
}

.hint {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
}

@media (max-width: 700px) {
  .flag {
    grid-template-columns: 1fr;
  }
}
</style>
