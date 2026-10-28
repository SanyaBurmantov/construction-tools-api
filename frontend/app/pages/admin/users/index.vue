<script setup lang="ts">
import type { CustomerType, UserRole } from '~/composables/useAuth'
import type { AdminUser, Paginated } from '~/types/api'
import { formatDate } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/**
 * `/admin/users` answers `{ data, total, page, limit }` rather than the usual
 * `pagination` envelope; `onResponse` rebuilds the pagination from those.
 */
type UsersResponse = Paginated<AdminUser> & { total: number, page: number, limit: number }

const { adminFetch, errorMessage, user: me } = useAdminApi()
const toast = useAppToast()
const { run, busy } = useAdminAction()

const filters = reactive({
  search: '',
  role: '' as '' | UserRole,
  isActive: '' as '' | 'true' | 'false',
})

const {
  rows: users,
  pagination,
  loading,
  error: loadError,
  load,
  setPage,
} = useAdminList<AdminUser, UsersResponse>('/users', {
  limit: 50,
  params: () => ({ ...filters }),
  errorText: 'Не удалось загрузить пользователей',
  onResponse: (response) => {
    pagination.value = {
      page: response.page,
      limit: response.limit,
      total: response.total,
      pages: Math.max(1, Math.ceil(response.total / response.limit)),
    }
  },
})

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
  legalAddress: '',
  bankAccount: '',
  bankName: '',
  bankBic: '',
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
    legalAddress: row.legalAddress ?? '',
    bankAccount: row.bankAccount ?? '',
    bankName: row.bankName ?? '',
    bankBic: row.bankBic ?? '',
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
  const requisitesError = isCompany.value ? requisitesProblem(form) : ''
  if (requisitesError) {
    formError.value = requisitesError
    return
  }

  const shared = {
    role: form.role,
    customerType: form.customerType,
    name: form.name.trim(),
    // '' clears a saved e-mail on update (the update DTO turns it into null);
    // the create DTO drops a blank one.
    email: form.email.trim(),
    phone: form.phone.trim(),
    companyName: form.companyName.trim(),
    taxId: form.taxId.trim(),
    legalAddress: form.legalAddress.trim(),
    bankAccount: form.bankAccount.trim(),
    bankName: form.bankName.trim(),
    bankBic: form.bankBic.trim(),
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

function toggleActive(row: AdminUser) {
  return run(
    () => adminFetch(`/users/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } }),
    { key: row.id, error: 'Не удалось изменить статус', after: load },
  )
}

const deleting = ref<AdminUser | null>(null)

async function confirmDelete() {
  const row = deleting.value
  if (!row) return
  await run(() => adminFetch(`/users/${row.id}`, { method: 'DELETE' }), {
    key: 'delete',
    error: 'Не удалось удалить пользователя',
    success: 'Пользователь удалён',
    after: () => {
      deleting.value = null
      return load()
    },
  })
}

/* ---- Display ----------------------------------------------------------- */
const isMe = (row: AdminUser) => row.id === me.value?.id
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Пользователи"
      description="Регистрация на сайте всегда создаёт покупателя — администратора можно создать только здесь. Откройте пользователя, чтобы увидеть его данные и историю заказов"
    >
      <UiButton variant="secondary" @click="openCreate('CUSTOMER')">
        Добавить покупателя
      </UiButton>
      <UiButton @click="openCreate('ADMIN')">Добавить администратора</UiButton>
    </AdminPageHead>

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
        <span v-if="isMe(row)" class="admin-muted hint">это вы</span>
      </template>

      <template #cell-role="{ row }">
        <UiBadge :tone="row.role === 'ADMIN' ? 'brand' : 'neutral'" size="sm">
          {{ row.role === 'ADMIN' ? 'Администратор' : 'Покупатель' }}
        </UiBadge>
        <UiBadge v-if="!row.isActive" tone="danger" size="sm">Отключён</UiBadge>
      </template>

      <template #cell-customer="{ row }">
        <span>{{ CUSTOMER_TYPE_LABEL[row.customerType as CustomerType] }}</span>
        <p v-if="row.companyName" class="admin-muted hint">
          {{ row.companyName }}<template v-if="row.taxId"> · УНП {{ row.taxId }}</template>
        </p>
        <p v-else-if="row.name" class="admin-muted hint">{{ row.name }}</p>
      </template>

      <template #cell-contacts="{ row }">
        <span v-if="row.email">{{ row.email }}</span>
        <p v-if="row.phone" class="admin-muted hint">{{ row.phone }}</p>
        <span v-if="!row.email && !row.phone" class="admin-muted">—</span>
      </template>

      <template #cell-createdAt="{ row }">
        <span>{{ formatDate(row.createdAt) }}</span>
        <p class="admin-muted hint">вход: {{ formatDate(row.lastLoginAt) }}</p>
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
            :loading="busy === row.id"
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

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="setPage"
    />

    <UiModal
      v-model:open="editorOpen"
      :title="editing ? `Пользователь ${editing.login}` : 'Новый пользователь'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="admin-form">
        <UiField v-if="!editing" label="Логин" required hint="Латинские буквы, цифры или e-mail" for="u-login">
          <UiInput id="u-login" v-model="form.login" autocomplete="off" placeholder="manager" />
        </UiField>

        <div class="admin-form-row">
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

        <div class="admin-form-row">
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

        <AccountCompanyRequisites v-if="isCompany" v-model="form" id-prefix="u" />

        <UiCheckbox v-if="editing" v-model="form.isActive" label="Активен" />
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <UiConfirm
      :open="Boolean(deleting)"
      title="Удалить пользователя?"
      :busy="busy === 'delete'"
      @update:open="deleting = null"
      @confirm="confirmDelete"
    >
      Учётная запись «{{ deleting?.login }}» и её сессии будут удалены.
      Оформленные заказы останутся — они не привязаны к аккаунту.
    </UiConfirm>
  </div>
</template>

<style scoped>
/* The explanation under the title is long; keep it a readable measure. */
.admin-page :deep(.admin-head p) {
  max-width: 60ch;
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

.hint {
  font-size: var(--text-xs);
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
}

.form-error {
  margin-bottom: var(--space-4);
}

@media (max-width: 900px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
