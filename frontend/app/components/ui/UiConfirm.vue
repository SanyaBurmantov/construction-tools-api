<script setup lang="ts">
/**
 * Confirmation dialog: «Отмена» + one action. The default slot is the
 * explanation. Opens while `open` is true; «Отмена», Escape and the backdrop
 * emit `update:open(false)`, the action emits `confirm`.
 */
withDefaults(
  defineProps<{
    title: string
    confirmLabel?: string
    tone?: 'danger' | 'primary'
    busy?: boolean
  }>(),
  { confirmLabel: 'Удалить', tone: 'danger' },
)

const open = defineModel<boolean>('open', { required: true })
defineEmits<{ confirm: [] }>()
</script>

<template>
  <UiModal v-model:open="open" :title="title" size="sm">
    <div class="confirm-text"><slot /></div>
    <template #footer>
      <UiButton variant="ghost" @click="open = false">Отмена</UiButton>
      <UiButton :variant="tone" :loading="busy" @click="$emit('confirm')">
        {{ confirmLabel }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.confirm-text {
  color: var(--text-muted);
}
</style>
