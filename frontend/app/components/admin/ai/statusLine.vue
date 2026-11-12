<script setup lang="ts">
import type { AiStatus } from '~/types/ai'

const props = defineProps<{ status: AiStatus | null }>()

/**
 * The spend cap, edited here instead of `AI_MIN_BALANCE` in `.env.prod`
 * (owner, 2026-11-12): under it the task runner and the assistant stop.
 * Money, so ADMIN only — the SEO role sees it, cannot change it.
 */
const { adminFetch, errorMessage, isSeo } = useAdminApi()
const { loadStatus } = useAiStatus()
const toast = useAppToast()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)

const floor = computed(() => props.status?.minBalance ?? null)
const floorLabel = computed(() => {
  const value = floor.value?.value
  return value ? value : 'нет'
})

function startEdit() {
  draft.value = floor.value?.value ?? ''
  editing.value = true
}

async function save(value: string | null) {
  saving.value = true
  try {
    await adminFetch('/ai/min-balance', { method: 'PATCH', body: { value } })
    await loadStatus()
    editing.value = false
    toast.success(value === null ? 'Порог взят из настроек сервера' : value ? `Остановка при балансе ниже ${value}` : 'Порог снят')
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="status" class="ai-status">
    <UiBadge :tone="status.enabled ? 'success' : 'danger'" size="sm" dot>
      {{ status.enabled ? `${status.provider} подключён` : 'Нет ключа ИИ (DEEPSEEK_API_KEY)' }}
    </UiBadge>
    <span>Модель по умолчанию: <code>{{ status.defaultModel }}</code></span>
    <span v-if="status.quota?.balance">Баланс: {{ status.quota.balance }}</span>

    <template v-if="floor">
      <form v-if="editing" class="floor-form" @submit.prevent="save(draft)">
        <label for="ai-min-balance">Стоп при балансе ниже</label>
        <UiInput id="ai-min-balance" v-model="draft" size="sm" placeholder="20 CNY" />
        <UiButton type="submit" size="sm" :loading="saving">Сохранить</UiButton>
        <UiButton v-if="floor.source === 'admin'" type="button" size="sm" variant="ghost" :disabled="saving" @click="save(null)">
          Как на сервере{{ floor.env ? ` (${floor.env})` : '' }}
        </UiButton>
        <UiButton type="button" size="sm" variant="ghost" :disabled="saving" @click="editing = false">Отмена</UiButton>
      </form>
      <span v-else class="floor" :title="floor.source === 'env' ? 'Из AI_MIN_BALANCE на сервере' : undefined">
        Стоп при балансе ниже: <strong>{{ floorLabel }}</strong>
        <UiButton v-if="!isSeo" type="button" size="sm" variant="link" @click="startEdit">Изменить</UiButton>
      </span>
    </template>

    <span v-if="status.quota?.dailyLimit != null">
      Бесплатных запросов сегодня: {{ status.quota.dailyRemaining }} из {{ status.quota.dailyLimit }}
    </span>
    <NuxtLink v-if="status.activeTasks" :to="{ path: '/admin/ai', query: { tab: 'tasks' } }">
      Активных задач: {{ status.activeTasks }}
    </NuxtLink>
  </div>
</template>

<style scoped>
.ai-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
  gap: var(--space-2) var(--space-4);
}

.floor,
.floor-form {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.floor strong {
  color: var(--text-strong);
}

.floor-form :deep(.ui-input) {
  width: 9rem;
}

code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

a {
  color: var(--brand);
  font-weight: 600;
}
</style>
