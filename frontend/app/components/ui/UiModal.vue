<script setup lang="ts">
const props = defineProps<{
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Hides the built-in close affordances for flows that must be resolved. */
  persistent?: boolean
}>()

const open = defineModel<boolean>('open', { required: true })
const dialog = ref<HTMLElement | null>(null)

function close() {
  if (!props.persistent) open.value = false
}

useModalA11y(open, dialog, close)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-root">
        <div class="backdrop" @click="close" />
        <div
          ref="dialog"
          class="dialog"
          :class="`size-${size || 'md'}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header v-if="title || $slots.header" class="dialog-header">
            <slot name="header">
              <h2>{{ title }}</h2>
            </slot>
            <button v-if="!persistent" type="button" class="close" aria-label="Закрыть" @click="close">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </button>
          </header>

          <div class="dialog-body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="dialog-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-root {
  position: fixed;
  z-index: var(--z-modal);
  display: grid;
  padding: var(--space-4);
  inset: 0;
  place-items: center;
}

.backdrop {
  position: absolute;
  background: rgb(12 17 29 / 55%);
  backdrop-filter: blur(3px);
  inset: 0;
}

.dialog {
  position: relative;
  display: flex;
  max-height: calc(100vh - var(--space-8));
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  box-shadow: var(--shadow-xl);
}

.size-sm {
  width: min(420px, 100%);
}

.size-md {
  width: min(620px, 100%);
}

.size-lg {
  width: min(860px, 100%);
}

.size-xl {
  width: min(1100px, 100%);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-4);
}

.dialog-header h2 {
  font-size: var(--text-xl);
}

.close {
  display: grid;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  place-items: center;
}

.close:hover {
  background: var(--surface-active);
  color: var(--text-strong);
}

.close svg {
  width: 18px;
  height: 18px;
}

.dialog-body {
  overflow-y: auto;
  padding: var(--space-6);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--duration-base) var(--ease-out);
}

.modal-enter-active .dialog,
.modal-leave-active .dialog {
  transition: transform var(--duration-base) var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .dialog,
.modal-leave-to .dialog {
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 640px) {
  .dialog-header,
  .dialog-body,
  .dialog-footer {
    padding-inline: var(--space-4);
  }
}
</style>
