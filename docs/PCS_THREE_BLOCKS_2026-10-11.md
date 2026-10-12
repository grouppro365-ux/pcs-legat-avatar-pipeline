# PCS: единый пакет входящих, кабинетов и сделки

Статус: PR67 опубликован после точного подтверждения пользователя. Миграция применена одной транзакцией; merge e7c451e72a5fe192004cd3b3a354bc0ce65f9e5b. API pcs-manager-live2 v61 ACTIVE (32 release files совпали); Vercel production dpl_1CGPi1gKBSeyjP2cERdTvRxxKhRK READY. cabinet.html/js/css, workflow-console.js и index.html получены по canonical URL с HTTP 200 и полным совпадением локальных файлов. Admin routes без авторизации вернули 401; недействительный cabinet token вернул 403. Ранее отклонённое применение миграции стало доступно после отдельного явного подтверждения пользователя. Предыдущий PR66 опубликован: merge aafb6c67bb1f6a9739aa2227ae395d30065a26c9, pcs-manager-live2 v60 ACTIVE, 28 файлов.

## Что входит

| Блок | Реализованный путь |
|---|---|
| Общие входящие | Оператор видит Neon CRM и действующий Supabase Conversation Hub в одном списке с явно указанным источником. Есть просмотр runtime-переписки и ручной ответ через существующий Telegram/LINE/WhatsApp/Facebook/Instagram transport. Ошибка одного источника показывается как неполный список. Не производится автоматическое слияние людей по имени. |
| Кабинеты | `cabinet.html` в существующем frontend. Оператор выпускает случайную персональную ссылку на 7 дней для канонического client_profile или ACTIVE partner; хранится SHA-256 токена. Доступ можно отозвать. Клиент видит свои заявки, разрешённые предложения и оплаты; партнёр — назначенные ему заявки и свои предложения. Внутренние заметки, коммерческие снимки и секреты не возвращаются. |
| Сделка и оплата | Новая заявка клиента или Telegram-заявка из входящих → назначение партнёра → предложение → одобрение оператором → выбор клиентом → подтверждение партнёром → подтверждение клиентом → реквизиты партнёра → сообщение о переводе → проверка оператором → PARTIALLY_PAID/PAID_TO_PARTNER. Используются существующие applications, pcs_partner_offers и функции подтверждения. Сумма проверенных переводов не превышает согласованную цену услуги; депозит показан отдельно. |

Клиентские команды имеют долговечные квитанции `(access_id, request_id)`, отпечаток содержания, блокировку повторов и точные серверные версии заявки. Предложение остаётся невидимым клиенту до одобрения. Перевод PENDING не меняет баланс. Номер перевода нельзя повторно зачесть по той же заявке. Проверка суммы, запись результата и изменение статуса оплаты происходят в одной транзакции с audit.

Ручные ответы используют действующий автомат состояний Conversation Hub. Квитанция провайдера сохраняется до записи истории; повтор после сбоя истории не отправляет второй ответ. Неизвестный результат отправки удерживается для проверки. Копия общего module в Edge bundle проверяется на полное совпадение с существующим исходником.

## Проверено

- 731 Node test, без ошибок; `git diff --check` и синтаксис новых JS/MJS пройдены.
- Полный синтетический SQL-сценарий на изолированной Neon ветке `br-nameless-cell-avf7ur5s`: запрос, предложение, approval, выбор, оба подтверждения, реквизиты, частичная оплата 400 THB и остаток 600 THB, итог 1000 THB. Проверены повтор команды, изменённый повтор, чужой клиент, сокрытие неопубликованного предложения, запрет преждевременного подтверждения/оплаты, дублирующий номер перевода, приватные поля и отзыв ссылки.
- Тест использует настоящие таблицы, FK и triggers скопированной ветки. В конце весь migration/fixture block откатывается. Отдельный read-only запрос подтвердил отсутствие новых таблиц и тестовых клиентов после отката. Production данные не изменены.
- Ручная доставка проверена fake transport: повтор без второго send, восстановление истории по квитанции, удержание неизвестной доставки. Настоящим клиентам сообщения не отправлялись.
- Проверки браузера и Telegram Mini App исключены по действующему указанию пользователя. Два конкурентных соединения отдельно не тестировались.

## Порядок публикации

1. После точного подтверждения применить `server/sql/pcs_portal_workflow.sql` в PCS business Neon, одной транзакцией.
2. Слить PR; опубликовать весь bundle `pcs-manager-live2` (включая четыре новых module). Прежняя custom admin auth сохраняется; отдельный `op=portal` проверяет только ограниченный непросроченный и неотозванный токен кабинета.
3. Проверить deployed version, соответствие всех release files, anonymous 401/403, frontend assets и роли на безопасных fixtures. Backend должен быть доступен до включения новых кнопок frontend.
4. Выдавать реальные персональные ссылки только назначенным владельцам. Выпуск ссылки не отправляет сообщение автоматически.

## Остаток ТЗ и границы этого пакета

Это базовый сквозной сценарий по трём выбранным блокам, а не завершение всех 75 разделов ТЗ. Действующий AI runtime используется без изменения модели и её production поведения. Пакет не доказывает автономную коммуникацию во всех каналах: нужны фактические подключения/права провайдеров, cutover и проверка scheduler, escalation, recovery и workflow outbox. Для Supabase контактов без Telegram ID автоматическая связь с каноническим клиентом остаётся закрытой до надёжной идентификации. Старые заявки без client_profile не получают клиентский доступ.

Ссылочный вход сохраняется для первого доступа. Добавлены учётные записи CLIENT/PARTNER через существующий Neon Auth; управление внутренней командой и персональные staff-права остаются отдельно. Вывод ограничен последними 100 заявками и 500 предложениями/переводами; архив требует дальнейшей пагинации. Нет автоматического межканального объединения идентичностей. Нет загрузки частных чеков; кабинет передаёт номер перевода/банковское подтверждение текстом.

По уточнению пользователя платёжные интеграции и эквайринг исключены из объёма: бот отправляет сохранённые реквизиты, оператор проверяет поступление. PCS-collects маршрут, возвраты, депозитный ledger, счета, партнёрские settlement/dispute и сводная revenue-аналитика остаются отдельными задачами; новые платёжные подтверждения видны в console сделки, не объединены с прежней Supabase finance-ledger витриной. Автомобильная бронь и договор остаются отдельным существующим путём, общая услуга не создаёт резерв машины без item/dates.

В более широком ТЗ также остаются контент/публикации и видео, attribution/learning, завершение облачного deployment/Telegram Serverless и реальная приёмка. Нельзя считать количество тестов процентом готовности.


## Проверка после публикации
- RLS включён на четырёх новых таблицах, PUBLIC table grants отсутствуют. Реальным клиентам QA-сообщения не отправлялись. Authenticated browser/Telegram production E2E остаётся открытым.
- Follow-up correction: сравнение runtime команды выполняется по стабильным полям, а не порядку ключей JSON. Regression fixture теперь сериализует записи с перестановкой ключей, как PostgreSQL JSONB; повтор и восстановление истории проходят без дополнительной отправки.
- Готовые SDK и scheduler переиспользуются; решения с GitHub и границы интеграции перечислены в PCS_OPEN_SOURCE_REUSE_2026-10-11.md.


## Автоматические действия после сделки
- Published manager v63 adds operator notifications from four canonical deal events through the existing 5-minute cron worker. Replays dedupe by event UUID, audit and event receipt are atomic, existing receipts can be repaired. External delivery status and attempts remain untouched.
- 733 Node tests and isolated SQL projection rollback checks passed. This closes internal operator reminders for these stages, external client/partner delivery remains a separate scope. Payment acquiring was explicitly excluded by the user.

## Отправка реквизитов ботом

Уточнение пользователя 2026-10-11: никаких платёжных интеграций. Сохранение реквизитов партнёра для подтверждённой заявки запускает автоматическую отправку через существующий 5-минутный cron. Канал берётся из связанного runtime contact. Цена услуги и возвратный депозит показаны отдельно; реквизиты отправляются дословно, без AI генерации. Устаревшая версия не отправляется; выбранный канал закрепляется на повтор.

Outbox привязан к заявке и версии реквизитов. Используется существующая квитанция Conversation Hub; при сбое записи истории доставка не повторяется. Неизвестная доставка, отсутствующий канал/контакт и слишком длинные реквизиты передаются оператору (notification/task), без обрезки банковских данных. Поступление денег по-прежнему проверяет оператор. Это автоматизация отправки реквизитов, а не автоматическая проверка банка. Новых production таблиц и постоянных процессов не требуется.

Проверки: unit tests для текста, устаревших данных, повторов, восстановления истории и неизвестной доставки; изолированный SQL rollback для очереди, версии, lease owner и атомарного audit. SQL fixtures используют временные копии таблиц без FK/triggers; два конкурентных соединения отдельно не проверялись. Browser/Telegram UI E2E остаётся исключённым по указанию пользователя.

Payment dispatch release checks: 740 Node tests passed; isolated Neon SQL rollback passed. Current production eligible count before release: 0.

## Учётные записи клиента и партнёра — 2026-10-11

Повторно используется уже подключённый Managed Better Auth в business Neon, официальный @neondatabase/auth 0.5.0-beta и jose 6.2.12 для проверки EdDSA/JWKS. Вход/регистрация/выход выполняются готовым SDK. Same-origin /pcs-auth proxy на существующем Vercel помогает webview работать с session cookies без третьего домена. Публичный Auth URL не является секретом.

После входа пользователь привязывает персональную ссылку оператора. Каноническая CLIENT/PARTNER роль и профиль берутся из pcs.portal_access; email и JWT role не создают бизнес-доступ. Привязка атомарно потребляет прежнюю ссылку, меняет её hash на закрытый server-only hash и продлевает доступ на год. Повтор той же привязки тем же пользователем безопасен; другой пользователь не может использовать потреблённую ссылку. Отзыв прежнего access_id оператором закрывает и аккаунт. Accounts не получают доступ в админку.

Проверено на изолированной ветке: настоящие sign-up, session restoration, JWT issuance, sign-out, sign-in; JWT проверен jose и отвергнут с чужим issuer. SQL rollback проверил привязку, повтор, чужую личность, потребление ссылки, блокировку и отзыв. Тестовые identity созданы только на QA branch, без сообщений реальным клиентам. UI browser/Telegram E2E остаётся исключённым. Shared SMTP существующего Auth остаётся прежним; настройка recovery/custom SMTP и внутренние staff/team роли — отдельный остаток. Sign-out прекращает сессию SDK; уже выданный JWT имеет окно до 15 минут, отзыв PCS access проверяется на каждом запросе.

Account release validation: 752 Node tests passed; managed Auth HTTP flow and canonical account SQL rollback passed.

Production proxy correction: direct Vercel external rewrites forward a hostname Neon rejects. A bounded same-origin auth forwarding function strips platform hostname headers, preserves HttpOnly cookies and accepts only the five implemented auth operations.

## 2026-10-12 — Personnel access and client stage delivery

`staff.html` reuses the already bundled official Neon Auth / Managed Better Auth SDK. Registration alone grants no PCS permissions. The administrator opens «Команда», selects a registered managed identity, assigns one existing global role or revokes access. OWNER/SUPER_ADMIN are protected and cannot be created or changed here. No production user has been auto-assigned a role. Six assignable roles: OPS_ADMIN, CONCIERGE_MANAGER, CATALOG_MANAGER, FINANCE_RECONCILIATION, AUDITOR_READONLY, PARTNERSHIP_MANAGER.

The manager validates managed JWTs with the existing jose verifier and reads current active global memberships and role_permissions on every request. Banned or inactive identities are denied; partner-scoped memberships never authorize global staff reads. Unknown routes and team management are denied to staff. Supported staff workspace: client conversations/intake, applications and approved offer review, payment instruction/transfer review for finance, catalog read and audit read according to actual permissions. Other internal modules remain administrator-only. Sensitive workflow finance/access sections are redacted. Workflow writes recheck permissions and append the real staff identity audit in the same canonical SQL transaction.

The existing 5-minute worker now also sends bounded client stage messages through the same durable delivery implementation as payment details: approved offer, partner confirmation/decline, recorded final client confirmation, operator-verified/rejected transfer, recorded service start/completion. RU/EN/TH fixed texts use canonical public terms. Verified transfer notices do not imply the entire price has been paid. Public price and refundable deposit stay separate. Every send revalidates current eligibility, freezes channel/text, uses existing provider receipts, and cancels obsolete events. Unknown delivery requires operator review; it does not automatically resend. Activation has a fixed timestamp; historical transitions are not backfilled. Partners retain their scoped cabinet and the operator receives the existing workflow notifications; no new partner-channel identity mapping was invented.

QA: isolated Neon rollback scenarios verified no signup privilege, existing role permissions, role replacement, immediate revoke/ban checks, owner protection, forbidden finance write, canonical staff audit, queue idempotency, blocked recipients, obsolete offer suppression and activation boundary. Managed Auth HTTP was verified in the prior account release. Actual browser/Telegram UI E2E remains excluded. No payment provider was added; saved partner bank details and manual transfer verification remain canonical.
