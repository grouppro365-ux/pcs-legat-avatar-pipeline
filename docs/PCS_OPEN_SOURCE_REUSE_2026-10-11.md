# Готовые компоненты PCS

Указание пользователя: где возможно брать готовые открытые решения, а не писать инфраструктуру с нуля. Проверены первичные GitHub repositories и фактические imports/cron metadata текущего проекта.

| Компонент | Источник | Использование в PCS |
|---|---|---|
| Supabase JavaScript SDK | https://github.com/supabase/supabase-js (MIT) | Уже подключён к опубликованному manager runtime-send: готовые PostgREST запросы к contacts/messages/events. Используются существующие Supabase Edge Functions и private secrets RPC. |
| Neon serverless driver | https://github.com/neondatabase/serverless (MIT) | Уже используется manager API для canonical CRM/business SQL, вместо своего сетевого драйвера. Импорт проекта остаётся @1.0.1; библиотека не обновлялась вслепую. |
| PostgreSQL cron | https://github.com/citusdata/pg_cron | Уже установлен в облачной базе. Active jobs: contact-memory каждую минуту, operator follow-up каждые 5 минут, public rules каждые 2 часа, retry каждую минуту, Telegram prospecting каждые 15 минут. Новый постоянный процесс/хост для расписания не создаётся. |
| PCS Conversation Hub delivery state machine | https://github.com/grouppro365-ux/pcs-legat-avatar-pipeline/blob/main/supabase/functions/_shared/message-processing.mjs | Переиспользован без переписывания алгоритма в Edge bundle. Отдельный regression проверяет полное совпадение source files. |
| PCS offer/client/partner confirmation functions | Existing business Neon `pcs.accept_partner_offer`, `pcs.partner_decide_selected_offer`, `pcs.client_confirm_selected_offer` | Кабинеты вызывают существующую бизнес-логику через проверку владельца, роли, версии и стадии, вместо параллельного CRM/сделочного механизма. |
| Postgres job queue candidate | https://github.com/timgit/pg-boss | Найден готовый вариант для более широких durable jobs. Пока не добавлен: существующие pcs_workflow_outbox и cron уже есть. Замена потребует миграции старых событий и проверки доставок, а не только установки npm. |

Открытые интеграционные задачи: обработчик workflow outbox, безопасный customer follow-up, полноценный cabinet/account/team auth, refunds/settlements. Эквайринг исключён пользователем; для оплаты нужны только сохранённые реквизиты и проверка оператором. Наличие библиотек не доказывает эти сценарии готовыми.

При следующей доработке reuse first: готовые SDK/auth primitives, установленный cron и канонический outbox; прикладной код ограничить проверками прав, связями PCS и отображением. Не включать старый customer-followup sender просто флагом: его job сейчас inactive, source читает Supabase каталог и делает внешние отправки до долговечной квитанции. Использовать действующий canonical availability и delivery state machine.

Отправка реквизитов переиспользует установленный cron, pcs_workflow_outbox и Conversation Hub delivery state machine. Платёжные SDK не добавлены.
