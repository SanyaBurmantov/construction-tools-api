<script setup lang="ts">
import type { ParserJob, ParserOverview, ParserSourceOverview, SourceDraft } from '~/types/parsing'

/**
 * «Управление парсингом» — the switches, the per-source settings form and the
 * manual job runner.
 *
 * Presentational: every piece of state belongs to the page. `drafts` is handed
 * over as the live object on purpose — the inputs edit the page's copy, which
 * is what keeps a reload from fighting someone's typing.
 */
const props = defineProps<{
  control: ParserOverview | null
  drafts: Record<string, SourceDraft>
  busy: string
  jobs: ParserJob[]
  jobsBusy: string
  expandedSource: string
}>()

const emit = defineEmits<{
  'update:expandedSource': [string]
  'toggle-cron': [boolean]
  'toggle-source': [string, boolean]
  'save': [string]
  'run-job': [ParserJob]
}>()

/**
 * The page seeds a draft for every source as `control` arrives, so this almost
 * always just hands back that object — the one the inputs edit. The local
 * fallback covers the frame before the first load answers; it is never read as
 * «изменено», because `isDirty` only looks at the page's own drafts.
 */
const fallbackDrafts = reactive<Record<string, SourceDraft>>({})

function draftFor(source: ParserSourceOverview): SourceDraft {
  return props.drafts[source.code] ?? (fallbackDrafts[source.code] ??= draftFromSource(source))
}

/** True when the form differs from what the server currently has. */
function isDirty(source: ParserSourceOverview) {
  const draft = props.drafts[source.code]
  return Boolean(draft) && !sameDraft(draft!, draftFromSource(source))
}

/** Один прогон каждые 30 минут — отсюда и скорость разбора очереди. */
const RUNS_PER_DAY = 48

/**
 * The number the admin actually needs: at the current batch size, how long the
 * remaining queue takes. 30 URL раз в полчаса на 39 000 товаров — это 27 дней,
 * и на глаз это неотличимо от остановки.
 */
function queueEta(source: ParserSourceOverview) {
  const perDay = source.batchLimit * RUNS_PER_DAY
  if (!source.effectiveEnabled) return 'парсинг выключен'
  if (!source.products.queued) return 'очередь пуста'
  const days = source.products.queued / perDay
  if (days < 1) return `~${Math.max(Math.round(days * 24), 1)} ч`
  return `~${Math.round(days)} дн (${perDay} URL/сутки)`
}

const expandedSourceRow = computed(() =>
  props.control?.sources.find(source => source.code === props.expandedSource) ?? null
)

const banner = computed(() => {
  const overview = props.control
  if (!overview) return { tone: 'info' as const, title: 'Загружаем состояние парсинга…', text: '' }

  if (!overview.cronEnabled) {
    return {
      tone: 'danger' as const,
      title: 'Парсинг остановлен',
      text: 'Крон выключен — очередь не разбирается. Включите переключатель ниже.',
    }
  }

  const idle = overview.sources.filter(source => !source.effectiveEnabled)
  if (idle.length === overview.sources.length) {
    return {
      tone: 'danger' as const,
      title: 'Парсинг остановлен',
      text: 'Крон включён, но все источники выключены по отдельности.',
    }
  }

  if (overview.isRunning) {
    return { tone: 'info' as const, title: 'Идёт разбор очереди', text: 'Прямо сейчас работает как минимум один парсер.' }
  }

  if (!overview.health.ok) {
    return {
      tone: 'warning' as const,
      title: 'Парсинг включён, но есть проблемы',
      text: `Есть ошибки, пропущенные запуски или устаревшие цены — смотрите состояние кронов и свежесть цен ниже.`,
    }
  }

  return {
    tone: 'success' as const,
    title: 'Парсинг работает',
    text: 'Очередь разбирается каждые 30 минут.',
  }
})

function toggleExpanded(code: string) {
  emit('update:expandedSource', props.expandedSource === code ? '' : code)
}
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Управление парсингом</h2>
        <p>
          Переключатели действуют сразу, без передеплоя: значение хранится в БД
          и перекрывает переменные окружения.
        </p>
      </div>
    </template>
    <template #actions>
      <UiButton
        :variant="control?.cronEnabled ? 'secondary' : 'primary'"
        size="sm"
        :loading="busy === 'cron'"
        @click="emit('toggle-cron', !control?.cronEnabled)"
      >
        {{ control?.cronEnabled ? 'Остановить парсинг' : 'Запустить парсинг' }}
      </UiButton>
    </template>

    <div class="pad">
      <UiAlert :tone="banner.tone" :title="banner.title">
        {{ banner.text }}
      </UiAlert>
    </div>

    <UiTable
      :columns="[
        { key: 'name', label: 'Источник' },
        { key: 'state', label: 'Крон', width: '150px', nowrap: true },
        { key: 'queue', label: 'Очередь товаров', width: '190px' },
        { key: 'batch', label: 'Пачка за запуск', width: '210px' },
        { key: 'eta', label: 'Разбор очереди', width: '180px', nowrap: true }
      ]"
      :rows="control?.sources ?? []"
      row-key="code"
      empty-text="Источники не настроены."
    >
      <template #cell-name="{ row }">
        <strong>{{ row.name }}</strong>
        <span class="code">{{ row.code }}</span>
      </template>

      <template #cell-state="{ row }">
        <UiButton
          size="sm"
          :variant="row.cronEnabled ? 'secondary' : 'ghost'"
          :loading="busy === `source-${row.code}`"
          @click="emit('toggle-source', row.code, !row.cronEnabled)"
        >
          {{ row.cronEnabled ? 'Включён' : 'Выключен' }}
        </UiButton>
        <p v-if="row.cronEnabled && !row.effectiveEnabled" class="muted hint">
          не работает: общий крон выключен
        </p>
      </template>

      <template #cell-queue="{ row }">
        <span>{{ row.products.queued }} в очереди</span>
        <p class="muted hint">
          обработано {{ row.products.visited }}, ошибок {{ row.products.failed }}
        </p>
      </template>

      <template #cell-batch="{ row }">
        <div class="batch-form">
          <UiInput v-model.number="draftFor(row).batchLimit" type="number" size="sm" min="1" max="2000" />
          <UiButton size="sm" variant="ghost" @click="toggleExpanded(row.code)">
            {{ expandedSource === row.code ? 'Свернуть' : 'Ещё…' }}
          </UiButton>
        </div>
      </template>

      <template #cell-eta="{ row }">
        <span class="muted">{{ queueEta(row) }}</span>
        <UiButton
          v-if="isDirty(row)"
          size="sm"
          :loading="busy === `settings-${row.code}`"
          class="save-btn"
          @click="emit('save', row.code)"
        >
          Сохранить
        </UiButton>
      </template>
    </UiTable>

    <!-- Расширенные настройки выбранного источника -->
    <div v-if="expandedSourceRow" class="pad advanced">
      <h3>{{ expandedSourceRow.name }} — настройки парсера</h3>

      <div class="advanced-grid">
        <UiField
          label="Пауза между запросами, мс"
          hint="Вежливость к поставщику. Меньше 1000 мс — только по согласованию с ним."
        >
          <UiInput
            v-model.number="draftFor(expandedSourceRow).requestDelayMs"
            type="number"
            size="sm"
            min="200"
            max="60000"
          />
        </UiField>

        <UiField
          label="Страниц за обход каталога"
          hint="Если счётчик обхода упирается ровно в это число — каталог обошёлся не весь."
        >
          <UiInput
            v-model.number="draftFor(expandedSourceRow).maxPages"
            type="number"
            size="sm"
            min="1"
            max="100000"
          />
        </UiField>

        <UiField
          v-if="expandedSourceRow.categoryBatchLimit !== undefined"
          label="Категорий за прогон"
          hint="Обход категорий идёт раз в час. Делите число ожидающих категорий на это значение — столько часов займёт полный круг."
        >
          <UiInput
            v-model.number="draftFor(expandedSourceRow).categoryBatchLimit"
            type="number"
            size="sm"
            min="1"
            max="200"
          />
        </UiField>
      </div>

      <UiField
        class="advanced-full"
        label="INCLUDE — брать только эти категории"
        hint="Регулярное выражение по цепочке хлебных крошек, без учёта регистра."
      >
        <UiInput v-model="draftFor(expandedSourceRow).categoryIncludeRegex" size="sm" placeholder="пусто = брать всё" />
      </UiField>

      <UiField
        class="advanced-full"
        label="EXCLUDE — не брать эти категории"
        hint="Применяется ко всей цепочке, поэтому правило ловит и подкатегории. Ошибка в выражении не сохранится — сервер её отклонит."
      >
        <UiInput v-model="draftFor(expandedSourceRow).categoryExcludeRegex" size="sm" />
      </UiField>

      <section class="jobs">
        <h4>Запустить вручную</h4>
        <p class="muted hint">
          Задание стартует в фоне: кнопка сообщает «запущено», а не «готово».
          Пока что-то выполняется, статус обновляется сам каждые 5 секунд.
        </p>

        <div v-for="job in jobs" :key="job.name" class="job">
          <div class="job-info">
            <strong>{{ job.label }}</strong>
            <p class="muted hint">{{ job.description }}</p>
            <p v-if="job.lastError" class="row-error" :title="job.lastError">
              {{ job.lastError }}
            </p>
          </div>

          <div class="job-state">
            <UiBadge v-if="job.isRunning" tone="info" size="sm">Выполняется</UiBadge>
            <UiBadge
              v-else-if="job.health"
              :tone="HEALTH_TONE[job.health] || 'neutral'"
              size="sm"
            >
              {{ HEALTH_LABEL[job.health] || job.health }}
            </UiBadge>
            <span class="muted hint">{{ formatAgo(job.lastSuccessAt) }}</span>
          </div>

          <UiButton
            size="sm"
            variant="secondary"
            :disabled="job.isRunning"
            :loading="jobsBusy === job.name"
            @click="emit('run-job', job)"
          >
            {{ job.isRunning ? 'Идёт…' : 'Запустить' }}
          </UiButton>
        </div>

        <p v-if="!jobs.length" class="muted">Заданий для этого источника нет.</p>
      </section>

      <div class="advanced-actions">
        <UiButton
          :loading="busy === `settings-${expandedSourceRow.code}`"
          :disabled="!isDirty(expandedSourceRow)"
          @click="emit('save', expandedSourceRow.code)"
        >
          Сохранить настройки
        </UiButton>
        <span class="muted">
          Значение перекрывает переменную окружения; передеплой не нужен.
        </span>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
/* The page owns the shared chrome (.pad, .muted, .code …) via :deep(). */
.batch-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.batch-form :deep(input) {
  width: 80px;
}

.save-btn {
  margin-left: var(--space-2);
}

.advanced {
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-muted);
}

.advanced h3 {
  margin-bottom: var(--space-3);
  font-size: var(--text-base);
  color: var(--text-strong);
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.advanced-full {
  margin-bottom: var(--space-3);
}

.jobs {
  padding-top: var(--space-4);
  margin-bottom: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.jobs h4 {
  margin-bottom: var(--space-1);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-strong);
}

.job {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.job:last-of-type {
  border-bottom: 0;
}

.job-info strong {
  color: var(--text-strong);
}

.job-state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

@media (max-width: 720px) {
  .job {
    grid-template-columns: 1fr auto;
  }

  .job-state {
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
  }
}

.advanced-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
</style>
