# PCS Operator: общий backlog — 2026-10-03

Проект не завершён. Эта запись заменяет представление о готовности по отдельным исправлениям договоров. Источник требований: MASTER PROMPT COMPLETE PCS OPERATOR, 75 разделов, и дополнение к дизайну от 2026-10-03.

## Доказательства и границы аудита

- Проверен существующий репозиторий grouppro365-ux/pcs-legat-avatar-pipeline, frontend pcs-ai-operator-v6, текущий CRM-адаптер и исходники действующего pcs-manager-live2 v7.
- Перечислены 100 активных Supabase Edge Functions и таблицы public с метаданными RLS. Наличие функции, строки или включённого RLS не доказывает работоспособность, права или безопасность.
- CRM читает contacts/conversations/messages в Neon. Существующая pcs_tasks в Supabase связана с pcs_contacts. Связь идентификаторов между хранилищами не подтверждена. 2026-10-03 дополнительная серверная проверка обнаружила каноническую Neon tasks с FK на Neon contacts; для ручных задач подключена именно она. Supabase pcs_tasks не смешивается с этой CRM.
- Прямой read-only запрос через Neon connector не выполнялся: соединение требует project_id. Секреты подключения не извлекались. Схема Neon и rollback-проверки SQL выполнены через существующий pg_net между серверами; ключи оставались внутри серверного запроса.
- Клиентский и партнёрский кабинеты не проверены. Отсутствие подходящего имени функции или файла в обследованной части проекта не доказывает отсутствие кабинета.
- Визуальная проверка узкого экрана и реальный сценарий в Telegram Mini App остаются непроверенными. Автоматические тесты не заменяют production E2E.

## Подтверждённые проблемы и порядок работ

| Приоритет | Блок | Состояние и следующее действие |
|---|---|---|
| P0 | Права и данные | Закрыт обход фаз аренды через application-status/application-save: generic маршруты не создают выдачу/возврат, не меняют locked booking и проверяют состояние также внутри UPDATE. Проверить остальные server-side roles, владельца записи, RLS policies и приватные файлы; завершённого аудита безопасности нет. |
| P1 | CRM Follow-up | Исправлен пустой POST: кнопка открывает редактируемый RU/EN/TH черновик; отправка только по нажатию пользователя через существующий /send. Фактическая доставка в Telegram не проверена, сообщения клиентам в ходе проверки не отправлялись. |
| P1 | AI-согласования | PARTIAL: очередь Neon подключена к отправке/отклонению после просмотра, с точной проверкой версии, атомарным audit, сохранённым захватом и квитанцией, защитой от повторов после открытия формы. Есть страницы по 200 записей. SQL и автоматические тесты пройдены; реальные Telegram E2E, генерация и автоматические workers остаются открытыми. |
| P1 | CRM редактирование и статусы | PARTIAL: редактор подключён к Neon contacts, сохраняет изменённые поля с точной проверкой версии и атомарным audit. Быстрые кнопки CRM подключены через предварительный просмотр редактора. Финансовый сценарий остаётся открытым. |
| P1 | Задачи | PARTIAL: Neon tasks доступны в карточке и общем списке из CRM/меню «Ещё». Фильтры открытых/просроченных/без срока, переход к клиенту, ручное завершение. Ответ разбит на страницы по 200 строк с переходами «Назад»/«Далее»; ошибки не выдаются за пустой список. Создание и завершение проверяют contact_id и записывают атомарный audit. Scheduler, автоматические напоминания, escalation и production UI E2E не проверены. |
| P1 | Диалог | Исправлены направление OUT и выборка последней тысячи сообщений: сначала новый ограниченный диапазон, затем хронологический показ с устойчивым порядком одинаковых дат. Synthetic read-only SQL на 1005 сообщениях подтвердил сохранение последних записей. Маршрутизация каналов, вложения, retry и защита от дублей остаются открытыми. |
| P1 | Client/Provider Cabinet | UNVERIFIED: найти действующий frontend, маршруты, auth, роли и связи данных; проверить клиентскую заявку и партнёрское подтверждение от начала до конца. |
| P1 | Запрос → offer → deal → payment | UNVERIFIED/PARTIAL: есть таблицы и отдельные функции; сквозной сценарий, availability и финансовая согласованность не доказаны. |
| P1 | Content / publishing | UNVERIFIED: исходники очереди, approvals, подключённые аккаунты, отправка и последующая проверка publication status требуют проверки. |
| P1 | Video / LTX | UNVERIFIED: проверить существующий backend, очередь и доступный hardware; не объявлять готовность по UI или mock. |
| P2 | Attribution / analytics / learning | UNVERIFIED: таблицы есть, полный цикл источник → revenue → результат → следующее решение не проверен. |

## Уже выполненный ограниченный блок договоров

Оригинальный прозрачный логотип сохранён. Реализованы загрузка фото и OCR через OpenRouter, HTTPS PDF download, версии договора, подтверждения подписания/выдачи/возврата, жизненный цикл аренды, история и защита от повторного нажатия. Подробные ограничения и проверки — в PCS_CONTRACT_*, PCS_RENTAL_LIFECYCLE_2026-10-03.md и PCS_UI_MIGRATION_2026-10-03.md. Это PARTIAL для всего автомобильного модуля, а не готовность всего проекта. Реальный download в Telegram и полный сценарий с авторизацией требуют проверки.

## Покрытие всех разделов ТЗ

UNVERIFIED означает, что пока нет достаточного доказательства готовности или отсутствия компонента. PARTIAL не означает завершённый production-сценарий. Разделы-принципы отмечены как требования, а не реализованные функции.

| № | Раздел | Статус |
|---|---|---|
| 1 | ЧТО ТАКОЕ PCS OPERATOR | Требование; выполнение не подтверждено |
| 2 | FIRST ACTION - FULL AUDIT | PARTIAL: аудит продолжается |
| 3 | SOURCE OF TRUTH | PARTIAL: выявлена граница Neon / Supabase |
| 4 | CRM CORE | PARTIAL: чтение, редактор, быстрые кнопки подключены; финансы открыты |
| 5 | EXISTING PCS OPERATIONAL STRUCTURE | Требование; выполнение не подтверждено |
| 6 | CONTACTS + IDENTITY RESOLUTION | UNVERIFIED |
| 7 | UNIFIED INBOX | PARTIAL: Telegram CRM; объединение каналов не проверено |
| 8 | AI COMMUNICATION AGENT | PARTIAL: ручные согласования Neon; генерация, внешние каналы и автоматические workers не проверены |
| 9 | PCS COMMUNICATION STYLE | Требование; выполнение не подтверждено |
| 10 | SERVICE REQUEST ENGINE | UNVERIFIED |
| 11 | DYNAMIC QUALIFICATION | UNVERIFIED |
| 12 | PARTNER SYSTEM | UNVERIFIED |
| 13 | PARTNER WORKFLOW | UNVERIFIED |
| 14 | INVENTORY ENGINE | UNVERIFIED |
| 15 | CAR MODULE | PARTIAL: договоры; весь модуль не проверен |
| 16 | REAL ESTATE MODULE | UNVERIFIED |
| 17 | OFFER ENGINE | UNVERIFIED |
| 18 | DEALS + PAYMENTS | UNVERIFIED |
| 19 | CLIENT CABINET | UNVERIFIED |
| 20 | PROVIDER / PARTNER CABINET | UNVERIFIED |
| 21 | TASK / FOLLOW-UP ENGINE | PARTIAL: ручной Follow-up, задачи и общий список со сроками; scheduler не проверен |
| 22 | ESCALATION | UNVERIFIED |
| 23 | CONFLICTS | UNVERIFIED |
| 24 | CONTENT SYSTEM | UNVERIFIED |
| 25 | BRANDS / ACCOUNTS | UNVERIFIED |
| 26 | SOCIAL CONNECTIONS | UNVERIFIED |
| 27 | CONTENT MEMORY | UNVERIFIED |
| 28 | CONTENT INTELLIGENCE | UNVERIFIED |
| 29 | COMPETITOR INTELLIGENCE | UNVERIFIED |
| 30 | COPYWRITING & ADVERTISING BRAIN | UNVERIFIED |
| 31 | DESIGN DNA ENGINE | UNVERIFIED |
| 32 | PLATFORM-NATIVE MEDIA | UNVERIFIED |
| 33 | CONTENT PLANNER | UNVERIFIED |
| 34 | AI CONTENT FACTORY | UNVERIFIED |
| 35 | AI VIDEO FACTORY | UNVERIFIED |
| 36 | LOCAL-FIRST VIDEO GENERATION | UNVERIFIED |
| 37 | LTX INTEGRATION | UNVERIFIED |
| 38 | LTX VIDEO BACKEND | UNVERIFIED |
| 39 | VIDEO JOB QUEUE | UNVERIFIED |
| 40 | HARDWARE AWARENESS | UNVERIFIED |
| 41 | VIDEO COST ROUTER | UNVERIFIED |
| 42 | VIDEO CREATIVE PIPELINE | UNVERIFIED |
| 43 | MULTI-SHOT GENERATION | UNVERIFIED |
| 44 | BRAND CONSISTENCY FOR VIDEO | UNVERIFIED |
| 45 | VIDEO POST-PROCESSING | UNVERIFIED |
| 46 | VIDEO QA | UNVERIFIED |
| 47 | HUMAN APPROVAL POLICY | Требование; выполнение не подтверждено |
| 48 | PUBLISHING ENGINE | UNVERIFIED |
| 49 | CONTENT PERFORMANCE | UNVERIFIED |
| 50 | CONTENT LEARNING LOOP | UNVERIFIED |
| 51 | ATTRIBUTION | UNVERIFIED |
| 52 | OPERATIONAL DASHBOARD | UNVERIFIED |
| 53 | TODAY PCS | UNVERIFIED |
| 54 | NOTIFICATIONS | UNVERIFIED |
| 55 | AUDIT LOG | PARTIAL: договоры и атомарный audit CRM; общий audit не проверен |
| 56 | PERMISSIONS | UNVERIFIED |
| 57 | SECURITY | UNVERIFIED |
| 58 | OBSERVABILITY | UNVERIFIED |
| 59 | FAILURE RECOVERY | UNVERIFIED |
| 60 | DATA QUALITY | UNVERIFIED |
| 61 | SEARCH | UNVERIFIED |
| 62 | AI KNOWLEDGE | UNVERIFIED |
| 63 | DOCUMENT KNOWLEDGE | UNVERIFIED |
| 64 | AI AUTHORITY MODEL | Требование; выполнение не подтверждено |
| 65 | TESTING | PARTIAL: тесты отдельных сценариев |
| 66 | REAL INTEGRATION TESTS | UNVERIFIED |
| 67 | PERFORMANCE | UNVERIFIED |
| 68 | MOBILE | PARTIAL: адаптация; визуальный E2E не подтверждён |
| 69 | UX PRINCIPLE | PARTIAL: интерфейс требует дальнейшей проверки |
| 70 | NO FAKE FEATURES | Требование; выполнение не подтверждено |
| 71 | MIGRATION STRATEGY | Требование; выполнение не подтверждено |
| 72 | IMPLEMENTATION PRIORITY | Требование; выполнение не подтверждено |
| 73 | DEFINITION OF DONE | Требование; выполнение не подтверждено |
| 74 | WHAT TO DO NOW | Требование; выполнение не подтверждено |
| 75 | FINAL PRODUCT PRINCIPLE | Требование; выполнение не подтверждено |

## Дополнение 04.10.2026

CRM/ручной Follow-up: добавлены сохранённый UUID попытки, проверка Telegram-подключения, защита от повторной отправки при неизвестной доставке, сохранение квитанции и audit одним SQL statement. Проверены формы и adapter; production SQL assertions выполнены с rollback. Это не закрывает автоматические Follow-up, AI approval-action и нативный Telegram E2E. Подробности: PCS_MANUAL_SEND_2026-10-04.md.

## Production acceptance: все 26 условий остаются открытыми

- [ ] 1. Клиент может прийти из реального канала.
- [ ] 2. Его conversation попадает в систему.
- [ ] 3. Contact/Lead создаётся или связывается.
- [ ] 4. AI/оператор квалифицирует запрос.
- [ ] 5. Request фиксируется.
- [ ] 6. Проверяется inventory/partner availability.
- [ ] 7. Формируется PCS Offer.
- [ ] 8. Клиент получает предложение.
- [ ] 9. Выбор превращается в Deal.
- [ ] 10. Payment/status фиксируется.
- [ ] 11. Услуга выполняется.
- [ ] 12. Follow-up работает.
- [ ] 13. Источник и revenue сохраняются.
- [ ] 14. Client Cabinet работает.
- [ ] 15. Provider Cabinet работает.
- [ ] 16. Content System создаёт platform-native контент.
- [ ] 17. Content System умеет создавать AI-video.
- [ ] 18. LTX local/self-hosted backend реально генерирует видео при доступном hardware.
- [ ] 19. Контент проходит QA.
- [ ] 20. Publishing реально работает.
- [ ] 21. Publication status проверяется после отправки.
- [ ] 22. Analytics возвращается в систему.
- [ ] 23. AI использует результаты для следующих решений.
- [ ] 24. Критические действия имеют audit trail.
- [ ] 25. Пользователь получает только значимые уведомления.
- [ ] 26. Система проходит end-to-end production verification.

Закрывать условие только с доказательством реального сценария и указанием ограничений. После каждого исправления обновлять этот backlog; блокировать только зависимую работу, продолжать независимые задачи.
