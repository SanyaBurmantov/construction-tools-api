<script setup lang="ts">
/**
 * Star rating. Read-only by default; pass `editable` to use it as an input
 * (keyboard-operable via the underlying radio group).
 */
const props = withDefaults(
  defineProps<{
    value?: number | null
    count?: number | null
    size?: 'sm' | 'md' | 'lg'
    editable?: boolean
    showValue?: boolean
    name?: string
  }>(),
  { size: 'md', name: 'rating' }
)

const model = defineModel<number>()
const hovered = ref(0)

const displayed = computed(() => {
  if (props.editable) return hovered.value || model.value || 0
  return props.value ?? 0
})

/** Percentage fill for star `index` (1-based), so 4.3 shows a partial star. */
function fill(index: number) {
  const delta = displayed.value - (index - 1)
  return `${Math.max(0, Math.min(1, delta)) * 100}%`
}
</script>

<template>
  <div class="ui-rating" :class="[`size-${size}`, { 'is-editable': editable }]">
    <div v-if="editable" class="stars" role="radiogroup" aria-label="Оценка">
      <label
        v-for="i in 5"
        :key="i"
        class="star-input"
        :aria-label="`${i} из 5`"
        @mouseenter="hovered = i"
        @mouseleave="hovered = 0"
      >
        <input v-model="model" type="radio" :name="name" :value="i">
        <svg viewBox="0 0 20 20" :class="{ 'is-on': i <= displayed }">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
      </label>
    </div>

    <div v-else class="stars" :aria-label="`Рейтинг ${value ?? 0} из 5`" role="img">
      <span v-for="i in 5" :key="i" class="star">
        <svg viewBox="0 0 20 20" class="star-bg">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
        <span class="star-clip" :style="{ width: fill(i) }">
          <svg viewBox="0 0 20 20" class="star-fg">
            <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z" />
          </svg>
        </span>
      </span>
    </div>

    <span v-if="showValue && value != null" class="value">{{ value.toFixed(1) }}</span>
    <span v-if="count != null" class="count">{{ count }}</span>
  </div>
</template>

<style scoped>
.ui-rating {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.stars {
  display: inline-flex;
  gap: 2px;
}

.star {
  position: relative;
  display: block;
  width: 1em;
  height: 1em;
}

.size-sm {
  font-size: 13px;
}

.size-md {
  font-size: 16px;
}

.size-lg {
  font-size: 24px;
}

svg {
  width: 1em;
  height: 1em;
}

.star-bg {
  fill: var(--border-default);
}

.star-clip {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  height: 100%;
}

.star-fg {
  fill: var(--amber-400);
}

.star-input {
  cursor: pointer;
  line-height: 0;
}

.star-input input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.star-input svg {
  fill: var(--border-default);
  transition: fill var(--duration-fast) var(--ease-out);
}

.star-input svg.is-on {
  fill: var(--amber-400);
}

.star-input input:focus-visible + svg {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.value {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.count {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.count::before {
  content: '(';
}

.count::after {
  content: ')';
}
</style>
