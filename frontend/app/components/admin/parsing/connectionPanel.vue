<script setup lang="ts">
import type { ConnectionState, ParserOverview, ProxyMode, RouteSnapshot } from '~/types/parsing'

/**
 * «Соединение с поставщиками»: does each supplier let our server in, directly
 * and through the proxy, and which way the parser goes now.
 *
 * Presentational like the other panels: the page owns the requests.
 */
const props = defineProps<{
  control: ParserOverview | null
  busy: string
}>()

const emit = defineEmits<{
  'save-proxy': [string | null]
  'toggle-images': [boolean]
  'set-mode': [string, ProxyMode]
  'check': [string]
}>()

const proxyInput = ref('')

const STATE_LABEL: Record<ConnectionState, string> = {
  UNKNOWN: 'нет данных',
  OK: 'пускает',
  DEGRADED: 'сбои',
  BLOCKED: 'блокирует',
}
const STATE_TONE: Record<ConnectionState, 'neutral' | 'success' | 'warning' | 'danger'> = {
  UNKNOWN: 'neutral',
  OK: 'success',
  DEGRADED: 'warning',
  BLOCKED: 'danger',
}
const MODE_OPTIONS: Array<{ value: ProxyMode, label: string }> = [
  { value: 'off', label: 'Напрямую' },
  { value: 'auto', label: 'Авто: прокси при блокировке' },
  { value: 'always', label: 'Всегда через прокси' },
]

const sources = computed(() => props.control?.sources ?? [])
const proxy = computed(() => props.control?.proxy ?? null)

function detail(route: RouteSnapshot) {
  if (route.state === 'UNKNOWN') return 'запросов ещё не было'
  if (route.state === 'OK') {
    return `ответ ${formatAgo(route.lastOkAt)}${route.lastMs !== null ? `, ${route.lastMs} мс` : ''}`
  }
  const why = route.failureKind === 'DENIED' ? `отвечает ${route.lastError}` : 'нет соединения'
  const since = route.blockedSince ? `, с ${formatDateTime(route.blockedSince)}` : ''
  return `${why}${since} · ${route.consecutiveFailures} ошибок подряд`
}

function saveProxy() {
  const value = proxyInput.value.trim()
  if (!value) return
  emit('save-proxy', value)
  proxyInput.value = ''
}
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Соединение с поставщиками</h2>
        <p>
          Пускает ли поставщик наш сервер — напрямую и через прокси. Сервер
          проверяет каждые 10 минут сам; пять ошибок подряд — «блокирует», и
          пачки этого источника не запускаются, пока соединение не вернётся.
        </p>
      </div>
    </template>

    <div class="pad proxy">
      <UiField
        label="Прокси"
        :hint="proxy?.configured
          ? `Сейчас: ${proxy.url}${proxy.from === 'env' ? ' (из переменной PARSER_PROXY_URL)' : ''}. Пароль не показывается и в журнал не пишется.`
          : 'HTTP(S)-прокси вида http://логин:пароль@host:порт. SOCKS не поддерживается.'"
      >
        <div class="proxy-row">
          <UiInput
            v-model="proxyInput"
            size="sm"
            type="password"
            autocomplete="off"
            :placeholder="proxy?.configured ? 'Новый адрес прокси' : 'http://логин:пароль@host:порт'"
            @keydown.enter="saveProxy"
          />
          <UiButton size="sm" :disabled="!proxyInput.trim()" :loading="busy === 'proxy'" @click="saveProxy">
            Сохранить
          </UiButton>
          <UiButton
            v-if="proxy?.configured"
            size="sm"
            variant="ghost"
            :loading="busy === 'proxy-clear'"
            @click="emit('save-proxy', null)"
          >
            Убрать прокси
          </UiButton>
        </div>
      </UiField>
      <UiCheckbox
        :model-value="proxy?.images ?? false"
        :disabled="!proxy?.configured || busy === 'proxy-images'"
        label="Фото поставщика тоже через прокси (≈65 КБ на фото — учитывайте тариф прокси)"
        @update:model-value="value => emit('toggle-images', Boolean(value))"
      />
    </div>

    <UiTable
      :columns="[
        { key: 'name', label: 'Поставщик' },
        { key: 'direct', label: 'Напрямую' },
        { key: 'proxy', label: 'Через прокси' },
        { key: 'mode', label: 'Режим', width: '230px' },
        { key: 'check', label: '', width: '120px', nowrap: true }
      ]"
      :rows="sources"
      row-key="code"
      empty-text="Источники не настроены."
    >
      <template #cell-name="{ row }">
        <strong>{{ row.host }}</strong>
        <p v-if="row.connection" class="hint" :class="row.connection.usable ? 'muted' : 'row-error'">
          {{ !row.connection.usable
            ? 'парсинг стоит — идти некуда'
            : row.connection.route === 'PROXY' ? 'сейчас идёт через прокси' : 'сейчас идёт напрямую' }}
        </p>
      </template>

      <template #cell-direct="{ row }">
        <template v-if="row.connection">
          <UiBadge :tone="STATE_TONE[row.connection.direct.state]" size="sm">
            {{ STATE_LABEL[row.connection.direct.state] }}
          </UiBadge>
          <p class="muted hint" :title="row.connection.direct.lastError ?? ''">
            {{ detail(row.connection.direct) }}
          </p>
        </template>
      </template>

      <template #cell-proxy="{ row }">
        <template v-if="row.connection?.proxy">
          <UiBadge :tone="STATE_TONE[row.connection.proxy.state]" size="sm">
            {{ STATE_LABEL[row.connection.proxy.state] }}
          </UiBadge>
          <p class="muted hint" :title="row.connection.proxy.lastError ?? ''">
            {{ detail(row.connection.proxy) }}
          </p>
        </template>
        <span v-else class="muted">прокси не настроен</span>
      </template>

      <template #cell-mode="{ row }">
        <UiSelect
          v-if="row.connection"
          :model-value="row.connection.mode"
          :options="MODE_OPTIONS"
          size="sm"
          :disabled="!proxy?.configured || busy === `mode-${row.code}`"
          @update:model-value="value => emit('set-mode', row.code, value as ProxyMode)"
        />
      </template>

      <template #cell-check="{ row }">
        <UiButton
          size="sm"
          variant="secondary"
          :loading="busy === `check-${row.code}`"
          @click="emit('check', row.code)"
        >
          Проверить
        </UiButton>
      </template>
    </UiTable>
  </UiCard>
</template>

<style scoped>
/* The page owns the shared chrome (.pad, .muted, .hint, .row-error …) via :deep(). */
.proxy {
  display: grid;
  gap: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.proxy-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.proxy-row :deep(.ui-input) {
  flex: 1 1 280px;
}
</style>
