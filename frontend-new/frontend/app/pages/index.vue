<template>
  <div class="home-page">
    <section class="hero">
      <h1>Строительные инструменты</h1>
      <p>Профессиональный инструмент для строительства и ремонта</p>
      <NuxtLink to="/catalog" class="btn-primary">
        Перейти в каталог
      </NuxtLink>
    </section>

    <section class="features">
      <div class="feature-card">
        <div class="feature-icon">🛠️</div>
        <h3>Широкий ассортимент</h3>
        <p>Более 10 000 товаров для строительства и ремонта</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🚚</div>
        <h3>Быстрая доставка</h3>
        <p>Доставляем по всей Беларуси в кратчайшие сроки</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">💰</div>
        <h3>Лучшие цены</h3>
        <p>Гарантируем конкурентные цены на весь ассортимент</p>
      </div>

      <div class="feature-card">
        <div class="feature-icon">🤝</div>
        <h3>Профессиональная поддержка</h3>
        <p>Поможем с выбором и ответим на все вопросы</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  gap: 60px;
  padding: 40px 0;
}

.hero {
  text-align: center;
  padding: 80px 20px;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%);
  border-radius: 16px;
  color: var(--color-text-light);
}

.hero h1 {
  font-size: 48px;
  font-weight: 700;
  margin-bottom: 16px;
}

.hero p {
  font-size: 20px;
  margin-bottom: 32px;
  opacity: 0.9;
}

.btn-primary {
  display: inline-block;
  padding: 16px 32px;
  background: var(--color-accent);
  color: var(--color-text-light);
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 18px;
  transition: background 0.2s ease, transform 0.2s ease;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
  transform: translateY(-2px);
}

.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 24px;
}

.feature-card {
  background: var(--color-bg-light);
  padding: 32px;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.08);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
}

.feature-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.feature-card h3 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--color-primary);
}

.feature-card p {
  font-size: 15px;
  color: var(--color-gray-medium);
  line-height: 1.5;
}
</style>