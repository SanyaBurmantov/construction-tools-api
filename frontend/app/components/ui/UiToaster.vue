<script setup lang="ts">
const { toasts, dismiss } = useAppToast()
</script>

<template>
  <Teleport to="body">
    <div class="toaster" role="region" aria-label="Уведомления">
      <TransitionGroup name="toast">
        <output
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="`tone-${toast.tone}`"
        >
          <div class="body">
            <strong v-if="toast.title">{{ toast.title }}</strong>
            <span>{{ toast.message }}</span>
          </div>
          <button type="button" aria-label="Закрыть" @click="dismiss(toast.id)">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </output>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toaster {
  position: fixed;
  z-index: var(--z-toast);
  right: var(--space-4);
  bottom: var(--space-4);
  display: flex;
  width: min(380px, calc(100vw - var(--space-8)));
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-left-width: 4px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  box-shadow: var(--shadow-lg);
  font-size: var(--text-sm);
  gap: var(--space-3);
  pointer-events: auto;
}

.body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.body span {
  color: var(--text-default);
  overflow-wrap: anywhere;
}

strong {
  color: var(--text-strong);
}

button {
  flex-shrink: 0;
  color: var(--text-subtle);
}

button:hover {
  color: var(--text-strong);
}

button svg {
  width: 16px;
  height: 16px;
}

.tone-info {
  border-left-color: var(--brand);
}

.tone-success {
  border-left-color: var(--success);
}

.tone-warning {
  border-left-color: var(--warning);
}

.tone-danger {
  border-left-color: var(--danger);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.toast-leave-active {
  position: absolute;
}
@media (max-width: 860px) {
  .toaster {
    bottom: calc(62px + var(--space-4) + env(safe-area-inset-bottom));
  }

  :global(body:has(.mobile-buy) .toaster) {
    bottom: calc(148px + var(--space-4) + env(safe-area-inset-bottom));
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
