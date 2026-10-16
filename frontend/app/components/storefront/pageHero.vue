<script setup lang="ts">
/**
 * The banner that opens a landing page — /sales, /brand, /brand/:slug. Each
 * used to carry its own copy of the same ~60 lines of CSS, differing only in
 * the accent colour. The default slot goes under the heading (copy, actions).
 */
withDefaults(defineProps<{
  eyebrow: string
  title?: string
  tone?: 'brand' | 'sale'
  stats?: Array<{ value: number | string, label: string }>
}>(), { title: '', tone: 'brand', stats: () => [] })
</script>

<template>
  <section class="page-hero" :class="`tone-${tone}`">
    <div class="hero-copy">
      <span class="eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <slot />
    </div>

    <div v-if="stats.length" class="hero-stats">
      <div v-for="stat in stats" :key="stat.label" class="hero-stat">
        <strong>{{ stat.value }}</strong>
        <span>{{ stat.label }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-hero {
  --hero-accent: var(--brand);
  --hero-soft: var(--brand-soft);

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--hero-soft), var(--surface-card));
}

.tone-sale {
  --hero-accent: var(--sale);
  --hero-soft: var(--sale-soft);
}

.hero-copy {
  display: flex;
  max-width: 60ch;
  flex-direction: column;
  gap: var(--space-2);
}

.eyebrow {
  color: var(--hero-accent);
}

.hero-copy :deep(p) {
  color: var(--text-muted);
}

.hero-stats {
  display: flex;
  gap: var(--space-3);
}

.hero-stat {
  display: flex;
  min-width: 110px;
  flex-direction: column;
  align-items: center;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.hero-stat strong {
  color: var(--hero-accent);
  font-size: var(--text-3xl);
  font-weight: 800;
  line-height: 1;
}

.hero-stat span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

@media (max-width: 640px) {
  .page-hero {
    padding: var(--space-5);
  }

  .hero-stats {
    width: 100%;
  }

  .hero-stat {
    flex: 1;
  }
}
</style>
