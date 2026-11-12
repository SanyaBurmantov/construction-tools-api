<script setup lang="ts">
/**
 * «ИИ-тексты → Помощник»: DeepSeek as a worker inside the shop. Each job has
 * a switch and a daily limit; all start off. The worker runs one step of one
 * switched-on job a minute. Below: what the jobs propose (accept / reject /
 * roll back) and the category+brand landings they wrote. Lead drafts show in
 * «Заявки», duplicate opinions in «Дубли».
 */
import type { AiAssistJob, AiAssistOverview, AiPrompt } from '~/types/ai'

const { adminFetch, errorMessage, isSeo } = useAdminApi()
const toast = useAppToast()
const { run, busy } = useAdminAction()

const data = ref<AiAssistOverview | null>(null)
const loadError = ref('')
const prompts = ref<AiPrompt[]>([])
const daily = ref<Record<string, number>>({})

async function load() {
  try {
    data.value = await adminFetch<AiAssistOverview>('/ai/assist')
    daily.value = Object.fromEntries(data.value.jobs.map(job => [job.key, job.settings.daily]))
    loadError.value = ''
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить помощника')
  }
}

onMounted(async () => {
  await load()
  prompts.value = await adminFetch<AiPrompt[]>('/ai/prompts', { params: { entity: 'PRODUCT' } }).catch(() => [])
})

async function save(job: AiAssistJob, patch: Record<string, unknown>, done: string) {
  await run(() => adminFetch(`/ai/assist/jobs/${job.key}`, { method: 'PUT', body: patch }), {
    key: `job:${job.key}`,
    error: 'Не удалось сохранить',
    success: done,
    after: load,
  })
}

async function runNow(job: AiAssistJob) {
  const result = await run(
    () => adminFetch<{ result: string, items: number, note?: string }>(`/ai/assist/jobs/${job.key}/run`, { method: 'POST' }),
    { key: `run:${job.key}`, error: 'Шаг не выполнился', after: load },
  )
  if (result) toast.success(`${RESULT_LABEL[result.result] ?? result.result}: ${result.items}${result.note ? ` · ${result.note}` : ''}`)
}

const RESULT_LABEL: Record<string, string> = {
  done: 'Сделано',
  idle: 'Нечего делать',
  limit: 'Дневной лимит исчерпан',
  off: 'Выключено',
  error: 'Ошибка',
  'rate-limited': 'Лимит ключа',
}

const templateOptions = computed(() => [
  { value: '', label: 'Только правила магазина' },
  ...(data.value?.presets ?? []).map(preset => ({ value: `preset:${preset.id}`, label: `Готовый · ${preset.title}` })),
  ...prompts.value.map(prompt => ({ value: `prompt:${prompt.id}`, label: `Мой · ${prompt.name}` })),
])

const PRODUCT_FIELDS = [
  { key: 'name', label: 'Название' },
  { key: 'descriptionShort', label: 'Краткое описание' },
  { key: 'descriptionFull', label: 'Полное описание' },
  { key: 'seoTitle', label: 'SEO title' },
  { key: 'seoDescription', label: 'SEO description' },
]

function toggleAutopilotField(job: AiAssistJob, key: string, on: boolean) {
  const fields = job.settings.fields ?? []
  const next = on ? [...new Set([...fields, key])] : fields.filter(item => item !== key)
  if (!next.length) {
    toast.error('Нужно хотя бы одно поле')
    return
  }
  void save(job, { fields: next }, 'Поля автопилота сохранены')
}

/** Where a job's results show up. */
const RESULTS_AT: Partial<Record<AiAssistJob['key'], { label: string, to: string }>> = {
  autopilot: { label: 'Задачи', to: '/admin/ai?tab=tasks' },
  leads: { label: 'Заявки', to: '/admin/leads' },
  duplicates: { label: 'Дубли', to: '/admin/duplicates' },
}

const tokens = (job: AiAssistJob) => job.usage.promptTokens + job.usage.completionTokens
const section = ref('suggestions')
</script>

<template>
  <div class="assist">
    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="!data" height="320px" radius="var(--radius-md)" />

    <template v-else>
      <UiAlert v-if="!data.enabled" tone="warning">Ключ ИИ не задан на сервере — помощник не работает.</UiAlert>
      <p class="muted">
        Каждая работа включается отдельно и по умолчанию выключена. Воркер делает один шаг одной включённой работы в минуту (один запрос к модели) по кругу; остановка по балансу — та же, что у задач (порог в строке статуса выше).
        Помощник сам меняет только то, что дёшево исправить и что откатывается; остальное предлагает ниже.
      </p>

      <UiAlert v-if="isSeo" tone="info">
        Включает работы, задаёт лимиты и шаблон автопилота администратор — они тратят оплаченный баланс DeepSeek. Предложения ниже можно принимать и отклонять.
      </UiAlert>

      <div class="jobs">
        <article v-for="job in data.jobs" :key="job.key" class="job" :class="{ 'is-on': job.settings.enabled }">
          <header>
            <strong>{{ job.title }}</strong>
            <UiCheckbox
              :model-value="job.settings.enabled"
              :label="job.settings.enabled ? 'Включено' : 'Выключено'"
              :disabled="isSeo || busy === `job:${job.key}`"
              @update:model-value="save(job, { enabled: Boolean($event) }, $event ? 'Включено' : 'Выключено')"
            />
          </header>
          <p class="muted">{{ job.description }}</p>

          <div class="limit">
            <UiInput v-model="daily[job.key]" type="number" min="0" max="5000" size="sm" :disabled="isSeo" :aria-label="`Лимит: ${job.unit}`" />
            <span class="muted">{{ job.unit }}</span>
            <UiButton
              v-if="Number(daily[job.key]) !== job.settings.daily"
              size="sm"
              variant="secondary"
              :loading="busy === `job:${job.key}`"
              @click="save(job, { daily: Number(daily[job.key]) }, 'Лимит сохранён')"
            >
              Сохранить
            </UiButton>
          </div>

          <template v-if="job.key === 'autopilot'">
            <UiField label="Шаблон задач" :for="`assist-template-${job.key}`">
              <UiSelect
                :id="`assist-template-${job.key}`"
                :model-value="job.settings.template ?? ''"
                :options="templateOptions"
                size="sm"
                :disabled="isSeo"
                @update:model-value="save(job, { template: String($event) }, 'Шаблон автопилота сохранён')"
              />
            </UiField>
            <div class="fields">
              <UiCheckbox
                v-for="field in PRODUCT_FIELDS"
                :key="field.key"
                :model-value="(job.settings.fields ?? []).includes(field.key)"
                :label="field.label"
                :disabled="isSeo"
                @update:model-value="toggleAutopilotField(job, field.key, Boolean($event))"
              />
            </div>
          </template>

          <p class="usage">
            Сегодня: <strong>{{ job.usage.items }}</strong> из {{ job.settings.daily }}
            · запросов {{ job.usage.requests }}<template v-if="tokens(job)"> · токенов {{ tokens(job) }}</template>
            <template v-if="job.usage.lastRunAt">
              <br>Последний шаг {{ formatDateTime(job.usage.lastRunAt) }}: {{ job.usage.lastResult }}
            </template>
          </p>

          <div class="actions">
            <UiButton size="sm" variant="ghost" :loading="busy === `run:${job.key}`" :disabled="isSeo || !data.enabled" @click="runNow(job)">
              Шаг сейчас
            </UiButton>
            <UiButton v-if="RESULTS_AT[job.key]" size="sm" variant="ghost" :to="RESULTS_AT[job.key]!.to">
              Результаты: {{ RESULTS_AT[job.key]!.label }}
            </UiButton>
          </div>
        </article>
      </div>

      <UiTabs
        v-model="section"
        :tabs="[
          { value: 'suggestions', label: 'Предложения', count: Object.values(data.pending).reduce((sum, n) => sum + (n ?? 0), 0) || null },
          { value: 'landings', label: 'Посадочные страницы', count: data.landings.published + data.landings.unpublished || null }
        ]"
      />
      <AdminAiAssistSuggestions v-if="section === 'suggestions'" :pending="data.pending" :auto-applied="data.autoAppliedCategories" @changed="load" />
      <AdminAiAssistLandings v-else @changed="load" />
    </template>
  </div>
</template>

<style scoped>
.assist {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.muted {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.jobs {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
}

.job {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.job.is-on {
  border-color: var(--brand);
}

.job header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.limit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.limit :deep(input) {
  width: 110px;
}

.fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
}

.usage {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  margin-top: auto;
  gap: var(--space-2);
}

code {
  font-family: var(--font-mono);
}
</style>
