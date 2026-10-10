<script setup lang="ts">
import type { AccountUser, CustomerType, UserRole } from '~/composables/useAuth'

definePageMeta({ layout: 'admin' })

type AdminUser = AccountUser & { _count?: { sessions: number } }

const { adminFetch, errorMessage, user: me } = useAdminApi()
const toast = useAppToast()

const users = ref<AdminUser[]>([])
const total = ref(0)
const page = ref(1)
const limit = 50
const loading = ref(false)
const loadError = ref('')

const filters = reactive({
  search: '',
  role: '' as '' | UserRole,
  isActive: '' as '' | 'true' | 'false',
})

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<{ data: AdminUser[], total: number }>('/users', {
      params: {
        page: page.value,
        limit,
        search: filters.search.trim() || undefined,
        role: filters.role || undefined,
        isActive: filters.isActive || undefined,
      },
    })
    users.value = response.data
    total.value = response.total
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить пользователей')
  } finally {
    loading.value = false
  }
}

onMounted(load)

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [filters.search, filters.role, filters.isActive],
  () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      page.value = 1
      void load()
    }, 300)
  }
)
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function goToPage(next: number) {
  page.value = next
  void load()
}

/* ---- Editor ------------------------------------------------------------ */
const editorOpen = ref(false)
const editing = ref<AdminUser | null>(null)
const saving = ref(false)
const formError = ref('')

const blankForm = () => ({
  login: '',
  password: '',
  role: 'CUSTOMER' as UserRole,
  customerType: 'INDIVIDUAL' as CustomerType,
  isActive: true,
  name: '',
  email: '',
  phone: '',
  companyName: '',
  taxId: '',
})

const form = reactive(blankForm())
const isCompany = computed(() => form.customerType === 'COMPANY')

function openCreate(role: UserRole = 'CUSTOMER') {
  editing.value = null
  Object.assign(form, blankForm(), { role })
  formError.value = ''
  editorOpen.value = true
}

function openEdit(row: AdminUser) {
  editing.value = row
  Object.assign(form, blankForm(), {
    login: row.login,
    role: row.role,
    customerType: row.customerType,
    isActive: row.isActive,
    name: row.name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    companyName: row.companyName ?? '',
    taxId: row.taxId ?? '',
  })
  formError.value = ''
  editorOpen.value = true
}

async function save() {
  formError.value = ''
  if (!editing.value) {
    if (form.login.trim().length < 3) {
      formError.value = 'Логин должен быть не короче 3 символов'
      return
    }
    if (form.password.length < 8) {
      formError.value = 'Пароль должен быть не короче 8 символов'
      return
    }
  } else if (form.password && form.password.length < 8) {
    formError.value = 'Новый пароль должен быть не короче 8 символов'
    return
  }
  if (isCompany.value && !form.companyName.trim()) {
    formError.value = 'Для юридического лица укажите название организации'
    return
  }

  const shared = {
    role: form.role,
    customerType: form.customerType,
    name: form.name.trim(),
    email: form.email.trim() || undefined,
    phone: form.phone.trim(),
    companyName: form.companyName.trim(),
    taxId: form.taxId.trim(),
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/users/${editing.value.id}`, {
        method: 'PATCH',
        // An empty password field means "leave it alone".
        body: {
          ...shared,
          isActive: form.isActive,
          password: form.password || undefined,
        },
      })
      toast.success(
        form.password ? 'Сохранено, пароль сброшен' : 'Пользователь сохранён'
      )
    } else {
      await adminFetch('/users', {
        method: 'POST',
        body: { ...shared, login: form.login.trim(), password: form.password },
      })
      toast.success(
        form.role === 'ADMIN' ? 'Администратор создан' : 'Пользователь создан'
      )
    }
    editorOpen.value = false
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить пользователя')
  } finally {
    saving.value = false
  }
}

async function toggleActive(row: AdminUser) {
  try {
    await adminFetch(`/users/${row.id}`, {
      method: 'PATCH',
      body: { isActive: !row.isActive },
    })
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось изменить статус'))
  }
}

const deleting = ref<AdminUser | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await adminFetch(`/users/${deleting.value.id}`, { method: 'DELETE' })
    toast.success('Пользователь удалён')
    deleting.value = null
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить пользователя'))
  } finally {
    deletingBusy.value = false
  }
}

/* ---- Display ----------------------------------------------------------- */
const dateFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const formatDate = (iso: string | null) =>
  iso ? dateFormatter.format(new Date(iso)) : '—'

const TYPE_LABEL: Record<CustomerType, string> = {
  INDIVIDUAL: 'Физ. лицо',
  COMPANY: 'Юр. лицо',
}

const isMe = (row: AdminUser) => row.id === me.value?.id
</script>

<template>
  <div class="admin-users">
    <header class="head">
      <div>
        <h1>Пользователи</h1>
        <p>
          Регистрация на сайте всегда создаёт покупателя — администратора можно
          создать только здесь. Откройте пользователя, чтобы увидеть его данные
          и историю заказов
        </p>
      </div>
      <div class="head-actions">
        <UiButton variant="secondary" @click="openCreate('CUSTOMER')">
          Добавить покупателя
        </UiButton>
        <UiButton @click="openCreate('ADMIN')">Добавить администратора</UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div class="filters">
      <UiInput
        v-model="filters.search"
        placeholder="Логин, имя, e-mail или организация"
        size="sm"
      />
      <UiSelect
        v-model="filters.role"
        size="sm"
        :options="[
          { value: '', label: 'Все роли' },
          { value: 'ADMIN', label: 'Администраторы' },
          { value: 'CUSTOMER', label: 'Покупатели' }
        ]"
      />
      <UiSelect
        v-model="filters.isActive"
        size="sm"
        :options="[
          { value: '', label: 'Активные и отключённые' },
          { value: 'true', label: 'Только активные' },
          { value: 'false', label: 'Только отключённые' }
        ]"
      />
    </div>

    <UiTable
      :columns="[
        { key: 'login', label: 'Логин' },
        { key: 'role', label: 'Роль', width: '150px', nowrap: true },
        { key: 'customer', label: 'Покупатель' },
        { key: 'contacts', label: 'Контакты' },
        { key: 'createdAt', label: 'Создан', width: '120px', nowrap: true },
        { key: 'actions', label: '', width: '320px', align: 'end' }
      ]"
      :rows="users"
      row-key="id"
      :loading="loading"
      empty-text="Пользователей не найдено."
    >
      <template #cell-login="{ row }">
        <NuxtLink :to="`/admin/users/${row.id}`" class="login-link">
          <strong>{{ row.login }}</strong>
        </NuxtLink>
        <span v-if="isMe(row)" class="muted hint">это вы</span>
      </template>

      <template #cell-role="{ row }">
        <UiBadge :tone="row.role === 'ADMIN' ? 'brand' : 'neutral'" size="sm">
          {{ row.role === 'ADMIN' ? 'Администратор' : 'Покупатель' }}
        </UiBadge>
        <UiBadge v-if="!row.isActive" tone="danger" size="sm">Отключён</UiBadge>
      </template>

      <template #cell-customer="{ row }">
        <span>{{ TYPE_LABEL[row.customerType as CustomerType] }}</span>
        <p v-if="row.companyName" class="muted hint">
          {{ row.companyName }}<template v-if="row.taxId"> · УНП {{ row.taxId }}</template>
        </p>
        <p v-else-if="row.name" class="muted hint">{{ row.name }}</p>
      </template>

      <template #cell-contacts="{ row }">
        <span v-if="row.email">{{ row.email }}</span>
        <p v-if="row.phone" class="muted hint">{{ row.phone }}</p>
        <span v-if="!row.email && !row.phone" class="muted">—</span>
      </template>

      <template #cell-createdAt="{ row }">
        <span>{{ formatDate(row.createdAt) }}</span>
        <p class="muted hint">вход: {{ formatDate(row.lastLoginAt) }}</p>
      </template>

      <template #cell-actions="{ row }">
        <div class="row-actions">
          <UiButton size="sm" variant="ghost" :to="`/admin/users/${row.id}`">
            Открыть
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="openEdit(row)">Изменить</UiButton>
          <UiButton
            v-if="!isMe(row)"
            size="sm"
            variant="ghost"
            @click="toggleActive(row)"
          >
            {{ row.isActive ? 'Отключить' : 'Включить' }}
          </UiButton>
          <UiButton
            v-if="!isMe(row)"
            size="sm"
            variant="ghost"
            @click="deleting = row"
          >
            Удалить
          </UiButton>
        </div>
      </template>
    </UiTable>

    <UiPagination :page="page" :pages="pages" :total="total" @change="goToPage" />

    <UiModal
      v-model:open="editorOpen"
      :title="editing ? `Пользователь ${editing.login}` : 'Новый пользователь'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="form">
        <UiField v-if="!editing" label="Логин" required hint="Латинские буквы, цифры или e-mail" for="u-login">
          <UiInput id="u-login" v-model="form.login" autocomplete="off" placeholder="manager" />
        </UiField>

        <div class="form-row">
          <UiField label="Роль" for="u-role">
            <UiSelect
              id="u-role"
              v-model="form.role"
              :options="[
                { value: 'CUSTOMER', label: 'Покупатель' },
                { value: 'ADMIN', label: 'Администратор' }
              ]"
            />
          </UiField>

          <UiField label="Тип покупателя" for="u-type">
            <UiSelect
              id="u-type"
              v-model="form.customerType"
              :options="[
                { value: 'INDIVIDUAL', label: 'Физическое лицо' },
                { value: 'COMPANY', label: 'Юридическое лицо' }
              ]"
            />
          </UiField>
        </div>

        <UiField
          :label="editing ? 'Новый пароль' : 'Пароль'"
          :required="!editing"
          :hint="editing
            ? 'Оставьте пустым, чтобы не менять. Смена пароля разлогинит пользователя'
            : 'Минимум 8 символов'"
          for="u-password"
        >
          <UiInput
            id="u-password"
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            placeholder="••••••••"
          />
        </UiField>

        <div class="form-row">
          <UiField label="Имя / контактное лицо" for="u-name">
            <UiInput id="u-name" v-model="form.name" />
          </UiField>

          <UiField label="Телефон" for="u-phone">
            <UiInput id="u-phone" v-model="form.phone" type="tel" />
          </UiField>
        </div>

        <UiField label="E-mail" for="u-email">
          <UiInput id="u-email" v-model="form.email" type="email" />
        </UiField>

        <template v-if="isCompany">
          <UiField label="Название организации" required for="u-company">
            <UiInput id="u-company" v-model="form.companyName" />
          </UiField>

          <UiField label="УНП" for="u-tax">
            <UiInput id="u-tax" v-model="form.taxId" />
          </UiField>
        </template>

        <UiCheckbox v-if="editing" v-model="form.isActive" label="Активен" />
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="Boolean(deleting)"
      title="Удалить пользователя?"
      size="sm"
      @update:open="deleting = null"
    >
      <p class="confirm-text">
        Учётная запись «{{ deleting?.login }}» и её сессии будут удалены.
        Оформленные заказы останутся — они не привязаны к аккаунту.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleting = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">
          Удалить
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-users {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p {
  max-width: 60ch;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 200px 220px;
  gap: var(--space-3);
}

.login-link strong {
  color: var(--text-link);
}

.login-link:hover strong {
  text-decoration: underline;
}

.muted {
  color: var(--text-muted);
}

.hint {
  font-size: var(--text-xs);
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.form-error {
  margin-bottom: var(--space-4);
}

.confirm-text {
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .filters,
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
