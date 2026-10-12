<script setup lang="ts">
import type { ParserHealth } from '~/types/parsing'

/** «Состояние кронов» — per-job health plus the freshness of supplier prices. */
defineProps<{ health: ParserHealth | null }>()
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Состояние кронов</h2>
        <p>
          Проверяем успешные запуски с учётом расписания каждой задачи
          и отдельно — свежесть цен поставщиков.
        </p>
      </div>
    </template>
    <template #actions>
      <UiBadge v-if="health" :tone="health.ok ? 'success' : 'danger'">
        {{ health.ok ? 'Всё в норме' : 'Требует внимания' }}
      </UiBadge>
    </template>

    <div v-if="health?.priceFreshness.length" class="pad">
      <h3>Свежесть цен поставщиков</h3>
      <p class="muted">Требует внимания, если {{ health.priceStalePercent }}% доступных офферов не обновлялись более {{ health.priceMaxAgeHours }} ч.</p>
      <div class="health-grid">
        <article v-for="source in health.priceFreshness" :key="source.sourceCode" class="health-card" :class="source.health === 'STALE' ? 'is-stale' : 'is-ok'">
          <div class="health-top">
            <strong>{{ source.sourceCode }}</strong>
            <UiBadge :tone="source.health === 'STALE' ? 'warning' : 'neutral'" size="sm">{{ source.health === 'EMPTY' ? 'Нет доступных цен' : source.health === 'STALE' ? 'Цены устарели' : 'Свежесть в норме' }}</UiBadge>
          </div>
          <dl class="health-meta">
            <div><dt>Устаревшие офферы</dt><dd>{{ source.stale }} / {{ source.total }} ({{ source.stalePercent }}%)</dd></div>
            <div><dt>Самое старое обновление</dt><dd>{{ formatAgo(source.oldestSync) }}</dd></div>
            <div><dt>Самое новое обновление</dt><dd>{{ formatAgo(source.newestSync) }}</dd></div>
          </dl>
        </article>
      </div>
    </div>

    <div v-if="health?.jobs.length" class="health-grid pad">
      <article v-for="job in health.jobs" :key="job.key" class="health-card" :class="`is-${job.health.toLowerCase()}`">
        <div class="health-top">
          <strong>{{ job.label }}</strong>
          <UiBadge :tone="HEALTH_TONE[job.health] || 'neutral'" size="sm">
            {{ HEALTH_LABEL[job.health] || job.health }}
          </UiBadge>
        </div>
        <dl class="health-meta">
          <div>
            <dt>Последний успех</dt>
            <dd :title="formatDateTime(job.lastSuccessAt)">{{ formatAgo(job.lastSuccessAt) }}</dd>
          </div>
          <div>
            <dt>Запусков</dt>
            <dd>{{ job.successes }} / {{ job.runs }}</dd>
          </div>
          <div v-if="job.failures">
            <dt>Сбоев</dt>
            <dd class="danger">{{ job.failures }}</dd>
          </div>
        </dl>
        <p v-if="job.lastError" class="health-error" :title="job.lastError">{{ job.lastError }}</p>
      </article>
    </div>
    <p v-else class="pad muted">Крон ещё не запускался после старта backend.</p>
  </UiCard>
</template>

<style scoped>
.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}

.health-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.health-card.is-ok { border-left-color: var(--success); }
.health-card.is-running { border-left-color: var(--info); }
.health-card.is-error { border-left-color: var(--danger); }
.health-card.is-stale { border-left-color: var(--warning); }

.health-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.health-top strong {
  overflow: hidden;
  color: var(--text-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}

.health-meta dt {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  text-transform: uppercase;
}

.health-meta dd {
  margin: 0;
  color: var(--text-default);
  font-size: var(--text-sm);
  font-weight: 600;
}

.health-error {
  display: -webkit-box;
  overflow: hidden;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger-soft-text);
  font-size: var(--text-xs);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
</style>
