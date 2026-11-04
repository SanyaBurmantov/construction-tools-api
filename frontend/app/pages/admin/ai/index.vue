<script setup lang="ts">
/**
 * «ИИ-тексты»: one screen for everything the AI writes. Pick rows on a tab
 * (товары / категории / бренды), tick fields, add instructions, try it on
 * one record, start a task; watch it under «Задачи»; tune the shop rules
 * and the template library under «Шаблоны и правила»; let DeepSeek work on
 * its own under «Помощник» (autopilot, categories, synonyms, lead drafts…). The open tab is kept
 * in `?tab=` so a link (and a reload) lands on it.
 */
definePageMeta({ layout: 'admin' })

const route = useRoute()
const router = useRouter()
const { status, loadStatus } = useAiStatus()

const TABS = ['products', 'categories', 'brands', 'tasks', 'rejected', 'templates', 'assist'] as const
type Tab = typeof TABS[number]

const tab = computed<Tab>({
  get: () => (TABS as readonly string[]).includes(String(route.query.tab))
    ? route.query.tab as Tab
    : 'products',
  set: value => void router.replace({ query: { ...route.query, tab: value === 'products' ? undefined : value } }),
})

onMounted(() => void loadStatus())

const tabs = computed(() => [
  { value: 'products', label: 'Товары' },
  { value: 'categories', label: 'Категории' },
  { value: 'brands', label: 'Бренды' },
  { value: 'tasks', label: 'Задачи', count: status.value?.activeTasks || null },
  { value: 'rejected', label: 'Отклонённое' },
  { value: 'templates', label: 'Шаблоны и правила' },
  { value: 'assist', label: 'Помощник' },
])

</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="ИИ-тексты"
      description="Отметьте записи → выберите поля и шаблон, допишите свои требования → проверьте на одной записи → создайте задачу. Модель пишет, программа проверяет и записывает; всё откатывается."
    />

    <AdminAiStatusLine :status="status" />

    <UiTabs v-model="tab" :tabs="tabs" />

    <AdminAiProductsTab v-if="tab === 'products'" @created="tab = 'tasks'" />
    <AdminAiCategoriesTab v-else-if="tab === 'categories'" @created="tab = 'tasks'" />
    <AdminAiBrandsTab v-else-if="tab === 'brands'" @created="tab = 'tasks'" />
    <AdminAiTasksTab v-else-if="tab === 'tasks'" />
    <AdminAiRejectedTab v-else-if="tab === 'rejected'" />
    <AdminAiTemplatesTab v-else-if="tab === 'templates'" />
    <AdminAiAssistTab v-else />
  </div>
</template>
