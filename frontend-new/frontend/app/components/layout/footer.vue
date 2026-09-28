<template>
  <footer class="footer">
    <div class="container">
      <div class="row top">
        <div class="col footer-about">
          <h2 class="footer-heading">Мультитул, г. Витебск</h2>
          <p>
            Надёжный белорусский поставщик крепежных изделий, ручного инструмента
            и электроинструмента из Китая, Тайваня и Европы.
          </p>
        </div>

        <div class="col footer-links-col">
          <h2 class="footer-heading">Ссылки</h2>
          <ul class="footer-links">
            <li><NuxtLink to="/catalog/">Каталог</NuxtLink></li>
            <li><NuxtLink to="/search/">Поиск</NuxtLink></li>
            <li><NuxtLink to="/brand/">Бренды</NuxtLink></li>
            <li><NuxtLink to="/sales/">Акции</NuxtLink></li>
            <li><NuxtLink to="/delivery/">Оплата и доставка</NuxtLink></li>
            <li><NuxtLink to="/contacts/">Контакты</NuxtLink></li>
          </ul>
        </div>

        <div class="col footer-contact">
          <h2 class="footer-heading">Контакты</h2>
          <ul class="footer-contact-list">
            <li>
              <svg class="icon" viewBox="0 0 24 24">
                <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z"/>
              </svg>
              Беларусь, г. Витебск, пр-т Фрунзе, 39а, к.17
            </li>
            <li>
              <a href="tel:+375298135797">
                <svg class="icon" viewBox="0 0 24 24">
                  <path d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9c.3-.3.8-.4 1.2-.3 1 .3 2 .5 3 .5.7 0 1.2.5 1.2 1.2v3c0 .7-.5 1.2-1.2 1.2C9.4 20 4 14.6 4 7.2 4 6.5 4.5 6 5.2 6h3c.7 0 1.2.5 1.2 1.2 0 1 .2 2 .5 3 .1.4 0 .9-.3 1.2l-2 1.4z"/>
                </svg>
                +375 (29) 813-57-97
              </a>
            </li>
            <li>
              <a href="mailto:dm.krep@mail.ru">
                <svg class="icon" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                </svg>
                dm.krep@mail.ru
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div class="row bottom">
        <p class="copyright">
          ООО Мультитул ©
        </p>
      </div>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.footer {
  background: var(--color-primary);
  color: var(--color-text-light);
  padding: 50px 0 30px;
  font-size: 16px;
  line-height: 1.7;

  .container {
    margin: 0 auto;
    padding: 0 20px;
    max-width: 1320px;
  }

  .row {
    &.top {
      display: flex;
      flex-wrap: wrap;
      gap: 70px;
      margin-bottom: 40px;
    }

    &.bottom {
      text-align: center;
      padding-top: 25px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 14px;
      color: var(--color-gray-extra-light);

      a {
        color: var(--color-accent);
        font-weight: 500;
        text-decoration: none;
        transition: all 0.3s ease;

        &:hover {
          color: var(--color-accent-hover);
          text-decoration: underline;
        }
      }
    }
  }

  .col {
    flex: 1 1 calc(33% - 47px);
    min-width: 280px;

    &.footer-about {
      p {
        color: var(--color-gray-extra-light);
        font-size: 15px;
        line-height: 1.8;
        margin-top: 10px;
      }
    }

    @media (max-width: 768px) {
      flex: 1 1 100%;
      margin-bottom: 30px;

      &:last-child {
        margin-bottom: 0;
      }
    }
  }

  .footer-heading {
    font-size: 22px;
    margin-bottom: 22px;
    font-weight: 700;
    color: var(--color-accent);
    position: relative;
    padding-bottom: 12px;

    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      width: 50px;
      height: 2px;
      background: var(--color-accent);
      border-radius: 2px;
    }
  }

  .footer-links {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      margin-bottom: 0;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        padding-left: 10px;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 4px;

        a {
          color: var(--color-accent);
          text-shadow: 0 0 1px rgba(206, 15, 61, 0.3);
        }
      }
    }

    a {
      color: var(--color-gray-extra-light);
      text-decoration: none;
      transition: all 0.3s ease;
      font-weight: 500;
      display: block;
      position: relative;

      &:hover {
        color: var(--color-accent);

        &::before {
          left: -10px;
          opacity: 1;
        }
      }
    }
  }

  .footer-contact-list {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
      gap: 14px;
      white-space: normal;
      width: 100%;
      padding: 8px 0;
      transition: all 0.3s ease;
      border-radius: 4px;

      &:hover {
        background: rgba(255, 255, 255, 0.03);
        padding-left: 8px;

        .icon {
          fill: var(--color-accent);
          transform: scale(1.1);
        }

        a, &:not(a) {
          color: var(--color-gray-light);
        }
      }

      &:not(a) {
        color: var(--color-gray-extra-light);
        line-height: 1.6;
      }
    }

    a {
      color: var(--color-gray-extra-light);
      text-decoration: none;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 500;

      &:hover {
        color: var(--color-accent);
      }
    }
  }

  .icon {
    width: 22px;
    height: 22px;
    fill: var(--color-gray-light);
    flex-shrink: 0;
    transition: all 0.3s ease;
  }

  .copyright {
    color: var(--color-gray-light);
    font-size: 14px;

    a {
      margin: 0 5px;
    }
  }

  @media (max-width: 768px) {
    padding: 40px 0 25px;
    font-size: 15px;

    .row.top {
      gap: 40px;
    }

    .footer-heading {
      font-size: 20px;
      margin-bottom: 18px;
    }
  }
}
</style>
