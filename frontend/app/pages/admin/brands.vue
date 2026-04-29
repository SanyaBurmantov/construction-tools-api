<script setup lang="ts">
type Brand = { id: string, name: string, slug: string, description?: string | null, country?: string | null }
const { token, loadToken, adminFetch } = useAdminApi()
const brands = ref<Brand[]>([])
const editingId = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const form = reactive({ name: '', slug: '', description: '', country: '' })
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '') }
function message(value: string, isError = false) { errorMessage.value = isError ? value : ''; successMessage.value = isError ? '' : value }
async function loadData() { if (!token.value) return; try { brands.value = await adminFetch<Brand[]>('/brands') } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить бренды', true) } }
function reset() { editingId.value = ''; Object.assign(form, { name: '', slug: '', description: '', country: '' }) }
function edit(brand: Brand) { editingId.value = brand.id; Object.assign(form, { name: brand.name, slug: brand.slug, description: brand.description || '', country: brand.country || '' }) }
async function save() { try { if (editingId.value) await adminFetch(`/brands/${editingId.value}`, { method: 'PATCH', body: form }); else await adminFetch('/brands', { method: 'POST', body: form }); message(editingId.value ? 'Бренд обновлен' : 'Бренд создан'); reset(); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось сохранить бренд', true) } }
async function remove(id: string) { if (!confirm('Удалить бренд? У товаров бренд будет сброшен.')) return; try { await adminFetch(`/brands/${id}`, { method: 'DELETE' }); message('Бренд удален'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось удалить бренд', true) } }
watch(() => form.name, value => { if (!editingId.value && !form.slug) form.slug = slugify(value) })
onMounted(() => { loadToken(); void loadData() })
useHead({ title: 'Бренды | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template><div class="admin-page"><NuxtLink to="/admin/" class="back-link">Админка</NuxtLink><h1>Бренды</h1><div v-if="errorMessage" class="notice error">{{ errorMessage }}</div><div v-if="successMessage" class="notice success">{{ successMessage }}</div><form class="admin-card form-grid" @submit.prevent="save"><div class="card-head"><h2>{{ editingId ? 'Редактировать бренд' : 'Новый бренд' }}</h2><button v-if="editingId" type="button" class="ghost" @click="reset">Отмена</button></div><input v-model="form.name" required placeholder="Название"><input v-model="form.slug" required placeholder="slug"><input v-model="form.country" placeholder="Страна"><textarea v-model="form.description" placeholder="Описание" /><button type="submit">{{ editingId ? 'Сохранить' : 'Создать' }}</button></form><section class="admin-card list"><div v-for="brand in brands" :key="brand.id" class="row"><div><strong>{{ brand.name }}</strong><span>{{ brand.slug }}</span></div><button type="button" class="ghost" @click="edit(brand)">Править</button><button type="button" @click="remove(brand.id)">Удалить</button></div></section></div></template>

<style scoped lang="scss">.admin-page{display:grid;gap:24px}.back-link{width:max-content;font-weight:900;text-decoration:none}h1{font-size:clamp(36px,6vw,68px)}.admin-card,.notice{border:2px solid var(--color-ink);border-radius:28px;background:rgba(255,250,240,.94);box-shadow:7px 7px 0 var(--color-ink);padding:22px}.notice.error{color:var(--color-accent-strong)}.notice.success{color:var(--color-green)}.form-grid,.list{display:grid;gap:12px}input,textarea{width:100%;border:1px solid var(--color-line);border-radius:14px;background:white;padding:12px 14px}textarea{min-height:92px;resize:vertical}button{border:2px solid var(--color-ink);border-radius:999px;background:var(--color-accent);cursor:pointer;font-weight:900;padding:12px 16px}.ghost{background:white}.card-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.row{display:grid;gap:12px;align-items:center;border:1px solid var(--color-line);border-radius:18px;background:white;padding:14px;@include media-breakpoint-up(md){grid-template-columns:minmax(0,1fr) auto auto}span{display:block;color:var(--color-muted);font-size:13px}}</style>
