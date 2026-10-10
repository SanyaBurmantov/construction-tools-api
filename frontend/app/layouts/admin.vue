<script setup lang="ts">
/**
 * Admin shell: one auth gate and one navigation for every admin screen.
 * Pages render inside the slot and can assume an ADMIN session is in place.
 *
 * The gate is a normal account login (the same session the storefront uses),
 * not the `ADMIN_TOKEN` form it used to be — that token stayed a
 * service-to-service header.
 */
const { authorized, adminFetch, errorMessage, refresh, logout, user, isAdmin }
  = useAdminApi()
const { login: signInWithPassword } = useAuth()

type Stats = {
  newOrders: number
  pendingReviews: number
  queuedSitemaps: number
  priceReviewNeeded: number
}

const checking = ref(true)
const signingIn = ref(false)
const signInError = ref('')
const badges = ref<Stats | null>(null)
const sidebarOpen = ref(false)
const credentials = reactive({ login: '', password: '' })

/** Signed in, but as a customer — a different problem from "not signed in". */
const forbidden = computed(() => Boolean(user.value) && !isAdmin.value)

const nav = computed(() => [
  { label: 'Дашборд', to: '/admin', icon: 'grid', exact: true },
  { label: 'Заказы', to: '/admin/orders', icon: 'cart', badge: badges.value?.newOrders },
  { label: 'Товары', to: '/admin/products', icon: 'box' },
  {
    label: 'Цены',
    to: '/admin/pricing',
    icon: 'tag',
    badge: badges.value?.priceReviewNeeded,
  },
  { label: 'Дубли', to: '/admin/duplicates', icon: 'copy' },
  { label: 'Баннеры', to: '/admin/banners', icon: 'image' },
  { label: 'Категории', to: '/admin/categories', icon: 'tree' },
  { label: 'Бренды', to: '/admin/brands', icon: 'tag' },
  {
    label: 'Отзывы',
    to: '/admin/reviews',
    icon: 'star',
    badge: badges.value?.pendingReviews,
  },
  { label: 'Промокоды', to: '/admin/promo-codes', icon: 'ticket' },
  { label: 'Пользователи', to: '/admin/users', icon: 'user' },
  { label: 'Журнал', to: '/admin/audit', icon: 'log' },
  { label: 'Парсинг', to: '/admin/parsing', icon: 'refresh' },
  { label: 'Документация', to: '/admin/docs', icon: 'book' },
])

const ICONS: Record<string, string> = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  cart: 'M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16H17a2 2 0 0 0 1.95-1.55L20.5 8H6',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4m0 0l8-4m-8 4v8',
  tree: 'M5 4h6v5H5zM13 11h6v5h-6zM13 4h6v5h-6zM8 9v9h5',
  tag: 'M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8-8-8zM8 8h.01',
  star: 'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z',
  ticket: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM8 7h7M8 11h7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0',
  log: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
}

/**
 * Who may enter is decided by the session alone: `/auth/me` is server-side
 * validated, so an ADMIN role there is proof enough.
 *
 * It used to also require `GET /admin/stats` to succeed — which coupled
 * "can I open the admin panel" to the heaviest query in the app (17 aggregates
 * in one Promise.all). On a saturated connection pool that endpoint times out
 * and nobody could get in at all, with a valid session and the right password.
 * The counters are now loaded separately: they are decoration, not a gate.
 */
function verify() {
  authorized.value = isAdmin.value
  if (authorized.value) void loadBadges()
  return authorized.value
}

/** Sidebar counters. A failure here must not cost anyone access. */
async function loadBadges() {
  try {
    badges.value = await adminFetch<Stats>('/stats')
  } catch {
    badges.value = null
  }
}

async function signIn() {
  signingIn.value = true
  signInError.value = ''
  try {
    const account = await signInWithPassword({
      login: credentials.login.trim(),
      password: credentials.password,
    })
    if (account.role !== 'ADMIN') {
      signInError.value = 'У этой учётной записи нет прав администратора'
      return
    }
    credentials.password = ''
    verify()
  } catch (error) {
    signInError.value = errorMessage(error, 'Неверный логин или пароль')
  } finally {
    signingIn.value = false
  }
}

async function signOut() {
  await logout()
  authorized.value = false
}

onMounted(async () => {
  try {
    await refresh()
    verify()
  } finally {
    // Whatever happened, stop showing the loading skeleton: a gate stuck in
    // "checking" is indistinguishable from a hung page.
    checking.value = false
  }
})

const route = useRoute()
watch(() => route.fullPath, () => {
  sidebarOpen.value = false
  // Keep the sidebar counters fresh as the admin moves around. Counters only —
  // a page change must not re-run the access check against a heavy endpoint.
  if (authorized.value) void loadBadges()
})

useHead({
  title: 'Админка | Мультитул',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <div class="admin-shell">
    <!-- Gate -->
    <div v-if="checking" class="gate">
      <UiSkeleton width="320px" height="180px" radius="var(--radius-lg)" />
    </div>

    <div v-else-if="forbidden" class="gate">
      <div class="login">
        <div class="login-brand">
          <BrandLogo size="sm" />
          <div>
            <h1>Доступ закрыт</h1>
            <p>Вы вошли как {{ user?.login }} — эта учётная запись не администратор</p>
          </div>
        </div>

        <UiButton size="lg" block variant="secondary" @click="signOut">
          Войти другой учётной записью
        </UiButton>

        <NuxtLink to="/" class="back">← Вернуться на сайт</NuxtLink>
      </div>
    </div>

    <div v-else-if="!authorized" class="gate">
      <form class="login" @submit.prevent="signIn">
        <div class="login-brand">
          <BrandLogo size="sm" />
          <div>
            <h1>Панель управления</h1>
            <p>Войдите учётной записью администратора</p>
          </div>
        </div>

        <UiField label="Логин" :error="signInError" for="admin-login">
          <UiInput
            id="admin-login"
            v-model="credentials.login"
            size="lg"
            autocomplete="username"
            placeholder="admin"
            :invalid="Boolean(signInError)"
          />
        </UiField>

        <UiField label="Пароль" for="admin-password">
          <UiInput
            id="admin-password"
            v-model="credentials.password"
            type="password"
            size="lg"
            autocomplete="current-password"
            placeholder="••••••••"
            :invalid="Boolean(signInError)"
          />
        </UiField>

        <UiButton type="submit" size="lg" block :loading="signingIn">Войти</UiButton>

        <NuxtLink to="/" class="back">← Вернуться на сайт</NuxtLink>
      </form>
    </div>

    <!-- Shell -->
    <div v-else class="shell">
      <aside class="sidebar" :class="{ 'is-open': sidebarOpen }">
        <div class="sidebar-head">
          <NuxtLink to="/admin" class="brand">
            <BrandLogo size="sm" />
          </NuxtLink>
          <button type="button" class="sidebar-close" aria-label="Закрыть меню" @click="sidebarOpen = false">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <nav class="sidebar-nav">
          <NuxtLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="nav-item"
            :class="{ 'is-active': item.exact ? route.path === item.to : route.path.startsWith(item.to) }"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="ICONS[item.icon]" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>{{ item.label }}</span>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </NuxtLink>
        </nav>

        <div class="sidebar-foot">
          <NuxtLink to="/" class="foot-link">Открыть сайт</NuxtLink>
          <button type="button" class="foot-link is-danger" @click="signOut">Выйти</button>
        </div>
      </aside>

      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />

      <div class="content">
        <header class="topbar">
          <button type="button" class="menu-toggle" aria-label="Меню" @click="sidebarOpen = true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
          <slot name="topbar" />
        </header>

        <main class="page">
          <slot />
        </main>
      </div>
    </div>

    <UiToaster />
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background: var(--surface-page);
}

.logo-mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--brand);
  color: #fff;
  font-weight: 800;
  place-items: center;
}

/* ---- Gate ---- */
.gate {
  display: grid;
  min-height: 100vh;
  padding: var(--space-6);
  place-items: center;
}

.login {
  display: flex;
  width: min(400px, 100%);
  flex-direction: column;
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  box-shadow: var(--shadow-lg);
  gap: var(--space-5);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.login-brand h1 {
  font-size: var(--text-xl);
}

.login-brand p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.back {
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.back:hover {
  color: var(--text-link);
}

/* ---- Shell ---- */
.shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  width: 248px;
  height: 100vh;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-card);
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-strong);
  font-weight: 800;
}

.sidebar-close {
  display: none;
  color: var(--text-muted);
}

.sidebar-close svg {
  width: 20px;
  height: 20px;
}

.sidebar-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--space-3);
  overflow-y: auto;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 600;
  gap: var(--space-3);
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.nav-item svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nav-item span:first-of-type {
  flex: 1;
}

.nav-item:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

.nav-item.is-active {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}

.nav-badge {
  display: grid;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--sale);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  place-items: center;
}

.sidebar-foot {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  gap: 2px;
}

.foot-link {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: left;
}

.foot-link:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

.foot-link.is-danger:hover {
  color: var(--danger);
}

.sidebar-backdrop {
  position: fixed;
  z-index: var(--z-overlay);
  background: rgb(12 17 29 / 50%);
  inset: 0;
}

/* ---- Content ---- */
.content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  min-height: 56px;
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-card);
  gap: var(--space-3);
}

.menu-toggle {
  display: none;
  color: var(--text-strong);
}

.menu-toggle svg {
  width: 22px;
  height: 22px;
}

.page {
  flex: 1;
  padding: var(--space-6);
}

@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    z-index: calc(var(--z-overlay) + 1);
    left: 0;
    transform: translateX(-100%);
    transition: transform var(--duration-base) var(--ease-out);
  }

  .sidebar.is-open {
    transform: translateX(0);
  }

  .sidebar-close,
  .menu-toggle {
    display: block;
  }

  .page {
    padding: var(--space-4);
  }
}
</style>
