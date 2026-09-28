<script setup lang="ts">
withDefaults(
  defineProps<{
    width?: string
    height?: string
    radius?: string
    lines?: number
  }>(),
  { height: '1em', lines: 1 }
)
</script>

<template>
  <div v-if="lines > 1" class="skeleton-stack">
    <span
      v-for="i in lines"
      :key="i"
      class="ui-skeleton"
      :style="{
        width: i === lines ? '60%' : width || '100%',
        height,
        borderRadius: radius || 'var(--radius-xs)'
      }"
    />
  </div>
  <span
    v-else
    class="ui-skeleton"
    :style="{ width: width || '100%', height, borderRadius: radius || 'var(--radius-xs)' }"
  />
</template>

<style scoped>
.skeleton-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ui-skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    var(--surface-sunken) 25%,
    var(--surface-hover) 37%,
    var(--surface-sunken) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
}

@keyframes shimmer {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0% 50%;
  }
}
</style>
