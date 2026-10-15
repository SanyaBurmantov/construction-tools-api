# To do при деплое: почта (SMTP hoster.by)

Что появилось в коде: письмо о каждом новом заказе на `MAIL_ADMIN_TO` и
письмо с подтверждением e-mail при регистрации (`/verify-email?token=…`).
Без настроек ниже отправка просто выключена — сайт работает, писем нет.

## 1. Сменить пароли ящиков

Пароли `support@`, `admin@`, `manager@gost.by` прошли через мессенджер —
сменить в панели hoster.by. В репозиторий их не писать.

## 2. Дописать в `.env.prod` на сервере

```
SMTP_HOST=mailbe03.hoster.by
SMTP_PORT=465
SMTP_USER=support@gost.by
SMTP_PASSWORD=<новый пароль от support@gost.by>
MAIL_FROM="gost.by <support@gost.by>"
MAIL_ADMIN_TO=admin@gost.by
PUBLIC_ORIGIN=https://gost.by
```

- `MAIL_ADMIN_TO` — можно несколько через запятую: `admin@gost.by,manager@gost.by`.
- `PUBLIC_ORIGIN` — обязательно настоящий домен, иначе ссылка в письме подтверждения поведёт не туда.
- `MAIL_FROM` — отправитель должен совпадать с ящиком `SMTP_USER`.
- Если 465 не подключается — поставить `SMTP_PORT=587`.

## 3. Задеплоить и перезапустить backend

Миграция `20261015120000_email_verification` (колонка `User.emailVerifiedAt`
и таблица `EmailVerification`) применится сама при старте контейнера
(`prisma migrate deploy`).

## 4. Проверить

- [ ] В логе backend есть строка `SMTP mail enabled via mailbe03.hoster.by as support@gost.by`
      (а не `SMTP mail disabled …`).
- [ ] Тестовый заказ → письмо «Новый заказ №…» пришло на `admin@gost.by`.
- [ ] Тестовая регистрация → письмо «Подтверждение регистрации на gost.by» пришло,
      ссылка открывает `/verify-email` и пишет «E-mail … подтверждён».
- [ ] В личном кабинете у нового аккаунта пропала плашка «E-mail не подтверждён».
- [ ] Если писем нет — смотреть в логе backend строки `Mail send failed …`.

## 5. DNS: DKIM и DMARC (чтобы письма не падали в спам)

Сейчас в DNS gost.by есть только SPF. Без DKIM Gmail и Mail.ru часто кладут
письма в спам, и письма подтверждения страдают первыми.

- [ ] Включить DKIM для gost.by в панели hoster.by (добавит TXT-запись).
- [ ] Добавить TXT-запись `_dmarc.gost.by` со значением `v=DMARC1; p=none`.

## Справка

- Подтверждение мягкое: неподтверждённый пользователь всё равно входит и
  оформляет заказ. E-mail при регистрации теперь обязателен (или логин = e-mail).
- Срок жизни ссылки — `EMAIL_VERIFICATION_TTL_HOURS` (по умолчанию 48).
- Повторная отправка письма из кабинета — не чаще 3 раз в час.
