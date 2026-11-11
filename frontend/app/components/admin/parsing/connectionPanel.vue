<script setup lang="ts">
import type { ConnectionState, ParserOverview, ParserProxy, ProxyMode, RouteSnapshot } from '~/types/parsing'

/**
 * «Соединение с поставщиками»: the proxies we have, and for each supplier
 * whether it lets our server in — directly and through its proxy — which proxy
 * it uses and when.
 *
 * Presentational like the other panels: the page owns the requests.
 */
const props = defineProps<{
  control: ParserOverview | null
  busy: string
}>()

const emit = defineEmits<{
  'add-proxy': [{ name: string, proxyUrl: string }]
  'update-proxy': [string, { name?: string, proxyUrl?: string }]
  'delete-proxy': [ParserProxy]
  'toggle-images': [boolean]
  'set-mode': [string, ProxyMode]
  'set-proxy': [string, string]
  'check': [string]
}>()

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
const proxies = computed(() => props.control?.proxies ?? [])
/** «Без прокси» first: a supplier uses a proxy only when one is picked for it. */
const proxyOptions = computed(() => [
  { value: '', label: 'Без прокси' },
  ...proxies.value.map(proxy => ({ value: proxy.id, label: proxy.name })),
])
const hostOf = (code: string) => sources.value.find(source => source.code === code)?.host ?? code

function detail(route: RouteSnapshot) {
  if (route.state === 'UNKNOWN') return 'запросов ещё не было'
  if (route.state === 'OK') {
    return `ответ ${formatAgo(route.lastOkAt)}${route.lastMs !== null ? `, ${route.lastMs} мс` : ''}`
  }
  const why = route.failureKind === 'DENIED' ? `отвечает ${route.lastError}` : 'нет соединения'
  const since = route.blockedSince ? `, с ${formatDateTime(route.blockedSince)}` : ''
  return `${why}${since} · ${route.consecutiveFailures} ошибок подряд`
}

/* New proxy */
const newProxy = reactive({ name: '', proxyUrl: '' })
function addProxy() {
  if (!newProxy.proxyUrl.trim()) return
  emit('add-proxy', { name: newProxy.name.trim(), proxyUrl: newProxy.proxyUrl.trim() })
  newProxy.name = ''
  newProxy.proxyUrl = ''
}

/* Editing one proxy: a new name and/or a new address (the old one is never shown). */
const editing = ref<string | null>(null)
const edit = reactive({ name: '', proxyUrl: '' })
function startEdit(proxy: ParserProxy) {
  editing.value = proxy.id
  edit.name = proxy.name
  edit.proxyUrl = ''
}
function saveEdit(proxy: ParserProxy) {
  const change: { name?: string, proxyUrl?: string } = {}
  if (edit.name.trim() && edit.name.trim() !== proxy.name) change.name = edit.name.trim()
  if (edit.proxyUrl.trim()) change.proxyUrl = edit.proxyUrl.trim()
  if (Object.keys(change).length) emit('update-proxy', proxy.id, change)
  editing.value = null
}
</script>

<template>
  <UiCard :padded="false">
    <template #header>
      <div class="card-head">
        <h2>Соединение с поставщиками</h2>
        <p>
          Пускает ли поставщик наш сервер — напрямую и через выбранный прокси.
          Сервер проверяет каждые 10 минут сам; пять ошибок подряд — «блокирует»,
          и пачки этого источника не запускаются, пока соединение не вернётся.
        </p>
      </div>
    </template>

    <div class="pad proxies">
      <h3>Прокси</h3>
      <p class="muted hint">
        HTTP(S)-прокси вида http://логин:пароль@host:порт (SOCKS не поддерживается).
        Пароль после сохранения не показывается и в журнал не пишется. Прокси
        используется только теми поставщиками, кому он выбран в таблице ниже;
        по умолчанию — «Без прокси».
      </p>

      <ul v-if="proxies.length" class="proxy-list">
        <li v-for="proxy in proxies" :key="proxy.id" class="proxy-item">
          <template v-if="editing === proxy.id">
            <UiInput v-model="edit.name" size="sm" placeholder="Название" class="proxy-name" />
            <UiInput
              v-model="edit.proxyUrl"
              size="sm"
              type="password"
              autocomplete="off"
              placeholder="Новый адрес (пусто — оставить прежний)"
              class="proxy-url"
              @keydown.enter="saveEdit(proxy)"
            />
            <div class="proxy-actions">
              <UiButton size="sm" :loading="busy === `proxy-${proxy.id}`" @click="saveEdit(proxy)">Сохранить</UiButton>
              <UiButton size="sm" variant="ghost" @click="editing = null">Отмена</UiButton>
            </div>
          </template>
          <template v-else>
            <div class="proxy-info">
              <strong>{{ proxy.name }}</strong>
              <span class="code">{{ proxy.url }}</span>
              <p class="muted hint">
                {{ proxy.usedBy.length ? `у ${proxy.usedBy.map(hostOf).join(', ')}` : 'никто не использует' }}
                <template v-if="proxy.from === 'env'"> · из переменной PARSER_PROXY_URL, меняется в .env.prod</template>
              </p>
            </div>
            <div v-if="proxy.from === 'admin'" class="proxy-actions">
              <UiButton size="sm" variant="ghost" @click="startEdit(proxy)">Изменить</UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                :loading="busy === `proxy-delete-${proxy.id}`"
                @click="emit('delete-proxy', proxy)"
              >
                Удалить
              </UiButton>
            </div>
          </template>
        </li>
      </ul>
      <p v-else class="muted">Прокси не добавлены — все поставщики идут напрямую.</p>

      <div class="proxy-add">
        <UiInput v-model="newProxy.name" size="sm" placeholder="Название (необязательно)" class="proxy-name" />
        <UiInput
          v-model="newProxy.proxyUrl"
          size="sm"
          type="password"
          autocomplete="off"
          placeholder="http://логин:пароль@host:порт"
          class="proxy-url"
          @keydown.enter="addProxy"
        />
        <UiButton size="sm" :disabled="!newProxy.proxyUrl.trim()" :loading="busy === 'proxy-add'" @click="addProxy">
          Добавить прокси
        </UiButton>
      </div>

      <UiCheckbox
        :model-value="control?.proxyImages ?? false"
        :disabled="!proxies.length || busy === 'proxy-images'"
        label="Фото поставщика тоже через прокси (≈65 КБ на фото — учитывайте тариф прокси)"
        @update:model-value="value => emit('toggle-images', Boolean(value))"
      />
    </div>

    <UiTable
      :columns="[
        { key: 'name', label: 'Поставщик' },
        { key: 'direct', label: 'Напрямую' },
        { key: 'proxy', label: 'Через прокси' },
        { key: 'mode', label: 'Прокси и режим', width: '240px' },
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
            : row.connection.route === 'PROXY'
              ? `сейчас идёт через «${row.connection.proxy?.name}»`
              : 'сейчас идёт напрямую' }}
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
        <template v-if="row.connection?.proxyState">
          <UiBadge :tone="STATE_TONE[row.connection.proxyState.state]" size="sm">
            {{ STATE_LABEL[row.connection.proxyState.state] }}
          </UiBadge>
          <p class="muted hint" :title="row.connection.proxyState.lastError ?? ''">
            {{ detail(row.connection.proxyState) }}
          </p>
        </template>
        <span v-else class="muted">без прокси</span>
      </template>

      <template #cell-mode="{ row }">
        <div v-if="row.connection" class="mode">
          <UiSelect
            :model-value="row.connection.proxy?.id ?? ''"
            :options="proxyOptions"
            size="sm"
            :disabled="!proxies.length || busy === `choice-${row.code}`"
            @update:model-value="value => emit('set-proxy', row.code, String(value ?? ''))"
          />
          <UiSelect
            v-if="row.connection.proxy"
            :model-value="row.connection.mode"
            :options="MODE_OPTIONS"
            size="sm"
            :disabled="busy === `mode-${row.code}`"
            @update:model-value="value => emit('set-mode', row.code, value as ProxyMode)"
          />
        </div>
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
/* The page owns the shared chrome (.pad, .muted, .hint, .code, .row-error …) via :deep(). */
.proxies {
  display: grid;
  gap: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.proxies h3 {
  font-size: var(--text-base);
  color: var(--text-strong);
}

.proxy-list {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.proxy-item,
.proxy-add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.proxy-item {
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.proxy-info {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-items: baseline;
  min-width: 0;
}

.proxy-info .hint {
  flex-basis: 100%;
}

.proxy-actions {
  display: flex;
  gap: var(--space-1);
}

.proxy-name {
  flex: 0 1 200px;
}

.proxy-url {
  flex: 1 1 280px;
}

.mode {
  display: grid;
  gap: var(--space-1);
}
</style>
