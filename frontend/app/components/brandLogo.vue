<script setup lang="ts">
/**
 * The wordmark. Inline SVG rather than an <img> so the mark takes its colour
 * from the brand token.
 */
withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'md' })
</script>

<template>
  <span class="brand-logo" :class="`size-${size}`">
    <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path
        class="glyph"
        d="M43.6 14.2a12.4 12.4 0 0 0-14.2 15.9L14.9 44.6a4.6 4.6 0 0 0 0 6.5l1.6 1.6a4.6 4.6 0 0 0 6.5 0l14.5-14.5a12.4 12.4 0 0 0 15.9-14.2l-7.2 7.2-6.6-1.8-1.8-6.6 7.2-7.2a12.6 12.6 0 0 0-1.4-1.4Z"
      />
    </svg>
    <span class="word">Gost.by</span>
  </span>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--brand);
}

.mark {
  flex-shrink: 0;
}

.glyph {
  fill: var(--surface-card);
}

.word {
  color: var(--text-strong);
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.size-sm .mark {
  width: 28px;
  height: 28px;
}

.size-sm .word {
  font-size: var(--text-md);
}

.size-md .mark {
  width: 34px;
  height: 34px;
}

.size-md .word {
  font-size: var(--text-lg);
}
</style>
