<script setup lang="ts">
useHead({
  title: 'Мультитул | Инструменты и крепеж',
  meta: [
    {
      name: 'description',
      content:
        'Мультитул: каталог строительного инструмента, крепежа и расходных материалов.'
    }
  ]
})
</script>

<template>
  <section class="home-hero">
    <div class="hero-copy">
      <span class="eyebrow">Витебск, Беларусь</span>
      <h1>
        Строительный каталог, в котором быстро находят нужную позицию
      </h1>
      <p>
        Собрали интерфейс вокруг готового API: товары, категории, бренды, цены,
        характеристики и поиск работают в одном каталоге.
      </p>
      <div class="hero-actions">
        <NuxtLink to="/catalog/" class="primary-link">Открыть каталог</NuxtLink>
        <a href="tel:+375298135797" class="secondary-link">Позвонить</a>
      </div>
    </div>

    <div class="hero-panel">
      <div class="tool-shape">дрель</div>
      <div class="tool-shape accent">крепеж</div>
      <div class="tool-shape dark">расходники</div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.home-hero {
  display: grid;
  gap: 32px;
  min-height: 620px;
  align-items: center;
  border: 2px solid var(--color-ink);
  border-radius: 44px;
  background:
    radial-gradient(circle at 82% 20%, rgba(222, 77, 47, 0.24), transparent 18rem),
    linear-gradient(135deg, rgba(255, 250, 240, 0.96), rgba(243, 182, 31, 0.28));
  box-shadow: 14px 14px 0 var(--color-ink);
  overflow: hidden;
  padding: clamp(28px, 6vw, 76px);

  @include media-breakpoint-up(lg) {
    grid-template-columns: 1fr 0.8fr;
  }
}

.hero-copy {
  max-width: 760px;
}

.eyebrow {
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1 {
  margin-top: 14px;
  font-size: clamp(40px, 7vw, 84px);
  line-height: 0.96;
}

p {
  max-width: 660px;
  margin-top: 22px;
  color: var(--color-muted);
  font-size: 19px;
  line-height: 1.75;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 34px;
}

.primary-link,
.secondary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  font-weight: 900;
  padding: 0 22px;
  text-decoration: none;
}

.primary-link {
  background: var(--color-accent);
  box-shadow: 5px 5px 0 var(--color-ink);
}

.secondary-link {
  background: white;
}

.hero-panel {
  position: relative;
  display: grid;
  min-height: 420px;
  place-items: center;
}

.tool-shape {
  position: absolute;
  display: grid;
  width: 240px;
  height: 150px;
  place-items: center;
  border: 2px solid var(--color-ink);
  border-radius: 34px;
  background: white;
  box-shadow: 8px 8px 0 var(--color-ink);
  font-family: var(--font-heading);
  font-size: 22px;
  transform: rotate(-8deg) translate(-70px, -80px);
}

.tool-shape.accent {
  background: var(--color-accent);
  transform: rotate(7deg) translate(60px, 30px);
}

.tool-shape.dark {
  background: var(--color-ink);
  color: white;
  transform: rotate(-2deg) translate(-20px, 150px);
}
</style>
