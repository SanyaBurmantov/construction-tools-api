<script setup lang="ts">
/** Left-hand sheet — used for mobile filters and the mobile nav. */
defineProps<{ title?: string }>()

const open = defineModel<boolean>('open', { required: true })
const panel = ref<HTMLElement | null>(null)

function close() {
  open.value = false
}

useModalA11y(open, panel, close)
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-root">
        <div class="backdrop" @click="close" />
        <aside
          ref="panel"
          class="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header class="panel-header">
            <h2>{{ title }}</h2>
            <button type="button" class="close" aria-label="Закрыть" @click="close">
              <UiIcon name="close" :size="18" :stroke-width="1.8" />
            </button>
          </header>
          <div class="panel-body u-scroll u-scroll--fade">
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
  background: var(--overlay-backdrop);
  inset: 0;
}

.panel {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: min(380px, 88vw);
  height: 100%;
  flex-direction: column;
  background: var(--surface-card);
  box-shadow: var(--shadow-xl);
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

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity var(--duration-base) var(--ease-out);
}

.drawer-enter-active .panel,
.drawer-leave-active .panel {
  transition: transform var(--duration-base) var(--ease-out);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .panel,
.drawer-leave-to .panel {
  transform: translateX(-100%);
}
</style>
