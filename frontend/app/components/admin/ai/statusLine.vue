<script setup lang="ts">
import type { AiStatus } from '~/types/ai'

defineProps<{ status: AiStatus | null }>()
</script>

<template>
  <div v-if="status" class="ai-status">
    <UiBadge :tone="status.enabled ? 'success' : 'danger'" size="sm" dot>
      {{ status.enabled ? 'OpenRouter подключён' : 'Нет OPENROUTER_API_KEY' }}
    </UiBadge>
    <span>Модель по умолчанию: <code>{{ status.defaultModel }}</code></span>
    <span v-if="status.quota?.dailyLimit != null">
      Бесплатных запросов сегодня: {{ status.quota.dailyRemaining }} из {{ status.quota.dailyLimit }}
    </span>
    <NuxtLink v-if="status.activeTasks" to="/admin/ai/tasks">
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

code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

a {
  color: var(--brand);
  font-weight: 600;
}
</style>
