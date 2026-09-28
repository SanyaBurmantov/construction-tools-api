<script setup lang="ts">
/** Side sheet — used for mobile filters and the mobile nav. */
withDefaults(
  defineProps<{
    title?: string
    side?: 'left' | 'right'
  }>(),
  { side: 'left' }
)

const open = defineModel<boolean>('open', { required: true })
const panel = ref<HTMLElement | null>(null)

function close() {
  open.value = false
}

useModalA11y(open, panel, close)
</script>

<template>
  <Teleport to="body">
    <Transition :name="`drawer-${side}`">
      <div v-if="open" class="drawer-root">
        <div class="backdrop" @click="close" />
        <aside
          ref="panel"
          class="panel"
          :class="`side-${side}`"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header class="panel-header">
            <h2>{{ title }}</h2>
            <button type="button" class="close" aria-label="Закрыть" @click="close">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </button>
          </header>
          <div class="panel-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="panel-footer">
            <slot name="footer" />
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-root {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
}

.backdrop {
  position: absolute;
  background: rgb(12 17 29 / 55%);
  inset: 0;
}

.panel {
  position: absolute;
  top: 0;
  display: flex;
  width: min(380px, 88vw);
  height: 100%;
  flex-direction: column;
  background: var(--surface-card);
  box-shadow: var(--shadow-xl);
}

.side-left {
  left: 0;
}

.side-right {
  right: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.panel-header h2 {
  font-size: var(--text-lg);
}

.close {
  display: grid;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  place-items: center;
}

.close:hover {
  background: var(--surface-active);
}

.close svg {
  width: 18px;
  height: 18px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
}

.panel-footer {
  display: flex;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-3);
}

.drawer-left-enter-active,
.drawer-left-leave-active,
.drawer-right-enter-active,
.drawer-right-leave-active {
  transition: opacity var(--duration-base) var(--ease-out);
}

.drawer-left-enter-active .panel,
.drawer-left-leave-active .panel,
.drawer-right-enter-active .panel,
.drawer-right-leave-active .panel {
  transition: transform var(--duration-base) var(--ease-out);
}

.drawer-left-enter-from,
.drawer-left-leave-to,
.drawer-right-enter-from,
.drawer-right-leave-to {
  opacity: 0;
}

.drawer-left-enter-from .panel,
.drawer-left-leave-to .panel {
  transform: translateX(-100%);
}

.drawer-right-enter-from .panel,
.drawer-right-leave-to .panel {
  transform: translateX(100%);
}
</style>
