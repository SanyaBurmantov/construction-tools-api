-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('GOAL', 'TASK');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'DROPPED');

-- CreateEnum
CREATE TYPE "PlanArea" AS ENUM ('SALES', 'SEO', 'ADS', 'CATALOG', 'CONTENT', 'TECH', 'OTHER');

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "kind" "PlanKind" NOT NULL DEFAULT 'TASK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'TODO',
    "area" "PlanArea" NOT NULL DEFAULT 'OTHER',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "dueDate" TIMESTAMP(3),
    "assignee" TEXT,
    "metric" TEXT,
    "target" DOUBLE PRECISION,
    "goalId" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "doneAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanItem_kind_status_idx" ON "PlanItem"("kind", "status");

-- CreateIndex
CREATE INDEX "PlanItem_goalId_idx" ON "PlanItem"("goalId");

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "PlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The plans as they stood on 2026-11-05 (from the work with the owner), so
-- the screen opens with the real list instead of an empty one. Targets are
-- starting points to edit, not decisions.
INSERT INTO "PlanItem" ("id", "kind", "title", "description", "status", "area", "priority", "dueDate", "assignee", "metric", "target", "goalId", "createdByName", "updatedAt") VALUES
('6f1c0e2a-0001-4a7e-9c11-000000000001', 'GOAL', 'Заказы с сайта: 10 в месяц', 'Считается сам: заказы текущего месяца без отменённых. Цель стартовая — поправьте под план владельца.', 'IN_PROGRESS', 'SALES', 1, NULL, NULL, 'orders_month', 10, NULL, 'Claude', CURRENT_TIMESTAMP),
('6f1c0e2a-0001-4a7e-9c11-000000000002', 'GOAL', 'Заказы организаций: 5 в месяц', 'Сайт делается для юрлиц: заказы со счётом или с компании-плательщика.', 'IN_PROGRESS', 'SALES', 1, NULL, NULL, 'company_orders_month', 5, NULL, 'Claude', CURRENT_TIMESTAMP),
('6f1c0e2a-0001-4a7e-9c11-000000000003', 'GOAL', 'Каталог в индексе Google', '05.11 (Search Console, выборка 70 адресов): в индексе ~30% товаров и ~45% категорий; из Google 136 кликов за 8 дней, рост 15 → 30 в день, средняя позиция ~11. Технических помех нет.', 'IN_PROGRESS', 'SEO', 1, '2026-12-31', NULL, NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
('6f1c0e2a-0001-4a7e-9c11-000000000004', 'GOAL', 'Уникальные тексты карточек', 'ИИ-тексты DeepSeek по шаблонам сеошника. Весь каталог ≈ $60. Стартовая цель — 5 000 карточек.', 'TODO', 'CONTENT', 2, NULL, NULL, 'ai_text_products', 5000, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Повторный замер пилота ИИ-текстов против контрольной группы', '05.11: в индексе 46/200 пилотных и 86/200 контрольных, но у 157 пилотных сменился адрес. Пилот со старым адресом — 44%, как контроль (43%). Повторить на тех же 400 карточках.', 'TODO', 'SEO', 2, '2026-11-20', 'разработка', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000004', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Решить: не менять адрес проиндексированных товаров при ИИ-переименовании', 'Смена адреса обнуляет индексацию на недели. Предложение: название и текст переписывать, а адрес из нового названия давать только товарам, которых ещё нет в индексе.', 'TODO', 'CONTENT', 1, NULL, 'владелец', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000004', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Подключить сеошника на 3 месяца с измеримыми целями', 'SEO 900–1200 руб/мес. Цели: страниц в индексе Google, клики и позиции (Search Console), заказы и заявки с источником «google / organic». Окупаемость при ~15% прибыли — около 8 000 руб продаж в месяц сверху. «Поведенческие» не брать.', 'TODO', 'SEO', 1, NULL, 'владелец', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000003', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Дать сеошнику доступ к Search Console и Метрике', 'Search Console — пользователь с ограниченным доступом; Метрика — гостевой доступ.', 'TODO', 'SEO', 2, NULL, 'владелец', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000003', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Шаблоны ИИ-текстов от сеошника, затем включить автопилот', 'Сеошник пишет требования в /admin/ai → «Шаблоны»; после предпросмотра включить работу «autopilot» в «Помощнике».', 'TODO', 'CONTENT', 2, NULL, 'сеошник', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000004', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Отправить sitemap в Яндекс.Вебмастер', 'API Яндекса отвечает 504 (атака на Яндекс, чинят). Повторить отправку sitemap и переобход главных страниц, когда заработает.', 'IN_PROGRESS', 'SEO', 2, NULL, 'разработка', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Регион «Беларусь» в Яндекс.Вебмастере', 'Вебмастер → Информация о сайте → Региональность, подтверждение страницей /contacts.', 'TODO', 'SEO', 2, NULL, 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Карточка организации в Яндекс Бизнесе', NULL, 'TODO', 'SEO', 2, NULL, 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Профиль компании в Google (Google Business Profile)', NULL, 'TODO', 'SEO', 2, NULL, 'владелец', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000003', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Настроить рекламу', 'Разовая настройка 700–1000 руб, ведение 400–500 руб/мес. Цели в Метрике уже есть (заказ, счёт, заявка, корзина, звонок) — реклама учится на заказах.', 'TODO', 'ADS', 2, NULL, 'владелец', NULL, NULL, '6f1c0e2a-0001-4a7e-9c11-000000000001', 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'th-tool.by не пускает прод-сервер', 'С 01.11 нет доступа с 87.232.67.114, цены и наличие этого поставщика не обновляются. Варианты: белый список у поставщика, прокси, реже.', 'TODO', 'CATALOG', 1, NULL, 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'DKIM для почты gost.by', 'Панель hoster.by → почта, запись в DNS — письма магазина реже попадают в спам.', 'TODO', 'TECH', 2, NULL, 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'DMARC: перевести в quarantine', 'p=none стоит с 04.11; через 2–4 недели, если отчёты чистые — p=quarantine (DNS на hoster.by).', 'TODO', 'TECH', 3, '2026-11-25', 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Отдельный S3-ключ для бэкапов', 'Сейчас бэкапы и фото под одним ключом.', 'TODO', 'TECH', 3, NULL, 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP),
(gen_random_uuid()::text, 'TASK', 'Роль базы без прав на изменение схемы', 'DB_APP_USER/DB_APP_PASSWORD в .env.prod и один запуск deploy/db-app-role.sh.', 'TODO', 'TECH', 3, NULL, 'владелец', NULL, NULL, NULL, 'Claude', CURRENT_TIMESTAMP);
