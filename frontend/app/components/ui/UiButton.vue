<script setup lang="ts">
/**
 * The one button in the app. Renders as <button>, <a> or <NuxtLink> depending
 * on what's passed, so link-shaped actions keep real navigation semantics.
 */
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'link'
    size?: 'sm' | 'md' | 'lg'
    to?: string
    href?: string
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    block?: boolean
    iconOnly?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
  }
)

const tag = computed(() => {
  if (props.to) return resolveComponent('NuxtLink')
  if (props.href) return 'a'
  return 'button'
})

const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :href="href"
    :type="to || href ? undefined : type"
    :disabled="to || href ? undefined : isDisabled"
    :aria-disabled="isDisabled || undefined"
    :aria-busy="loading || undefined"
    class="ui-button"
    :class="[
      `is-${variant}`,
      `is-${size}`,
      { 'is-block': block, 'is-icon-only': iconOnly, 'is-loading': loading, 'is-disabled': isDisabled }
    ]"
  >
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <slot v-else name="leading" />
    <span v-if="!iconOnly" class="label"><slot /></span>
    <slot v-else />
    <slot name="trailing" />
  </component>
</template>

<style scoped>
.ui-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.ui-button:active:not(.is-disabled) {
  transform: translateY(1px);
}

.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* ---- Sizes ---- */
.is-sm {
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  min-height: 34px;
}

.is-md {
  padding: 0 var(--space-4);
  font-size: var(--text-base);
  min-height: 42px;
}

.is-lg {
  padding: 0 var(--space-6);
  font-size: var(--text-md);
  min-height: 50px;
}

.is-icon-only.is-sm {
  width: 34px;
  padding: 0;
}

.is-icon-only.is-md {
  width: 42px;
  padding: 0;
}

.is-icon-only.is-lg {
  width: 50px;
  padding: 0;
}

.is-block {
  display: flex;
  width: 100%;
}

/* ---- Variants ---- */
.is-primary {
  background: var(--brand);
  color: var(--text-inverse);
  box-shadow: var(--shadow-xs);
}

.is-primary:hover:not(.is-disabled) {
  background: var(--brand-hover);
}

.is-secondary {
  border-color: var(--border-default);
  background: var(--surface-card);
  color: var(--text-strong);
  box-shadow: var(--shadow-xs);
}

.is-secondary:hover:not(.is-disabled) {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.is-ghost {
  background: transparent;
  color: var(--text-muted);
}

.is-ghost:hover:not(.is-disabled) {
  background: var(--surface-active);
  color: var(--text-strong);
}

.is-danger {
  background: var(--danger);
  color: #fff;
}

.is-danger:hover:not(.is-disabled) {
  background: var(--danger-hover);
}

.is-success {
  background: var(--success);
  color: #fff;
}

.is-link {
  padding: 0;
  background: none;
  color: var(--text-link);
  min-height: auto;
}

.is-link:hover:not(.is-disabled) {
  text-decoration: underline;
}

/* ---- Loading ---- */
.spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentcolor;
  border-radius: 50%;
  border-right-color: transparent;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
