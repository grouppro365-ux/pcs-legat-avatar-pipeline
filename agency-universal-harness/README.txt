AGENCY UNIVERSAL HARNESS v1.0.0
================================

Что это
-------
Локальное Manifest V3 расширение для Opera/Chromium, построенное по принципам Browser Harness:
Observe → Act → Verify → Learn.

Открытая вкладка ChatGPT используется как reasoning surface. OpenAI API key не нужен.

Установка
---------
1. Распаковать ZIP.
2. Открыть opera://extensions/.
3. Включить «Режим разработчика».
4. Нажать «Загрузить распакованное».
5. Выбрать папку Agency-Universal-Harness — в ней сразу лежит manifest.json.
6. Открыть конкретный разговор ChatGPT и нажать в расширении «Привязать текущий ChatGPT».
7. Открыть рабочий сайт и нажать «Привязать текущий рабочий сайт».
8. Ввести задачу и запустить.

Архитектура
-----------
- service_worker.js — durable orchestration/state, explicit bindings, request IDs, completion gate.
- chatgpt_adapter.js — scoped ChatGPT composer/send/answer bridge; no blind retry after uncertain send.
- page_agent.js — typed browser actions and postcondition verification; no raw JavaScript execution.
- policy.js — local safety gate, secret-field block, same-origin navigation, one-shot confirmation for dangerous clicks.
- popup.html / popup.js — простой интерфейс, журнал, подтверждения и итог.

Безопасность
------------
- Нет raw eval / Function() / arbitrary JavaScript protocol.
- Нет OpenAI API key или api.openai.com.
- Не читаются значения password/OTP/card fields.
- URL, передаваемый в reasoning, очищается до origin + pathname.
- Cross-origin переходы требуют явной перепривязки сайта.
- Publish/Send/Delete/Pay/Transfer/permissions и подобные действия требуют одноразового подтверждения.
- «Готово» отклоняется, если выполненные мутации не подтверждены postcondition-проверкой.
- Автоматический retry опасной мутации не используется.

Ограничения v1.0.0
-----------------
Это первый универсальный runtime. Реальный live E2E всё равно надо проверить в установленной Opera, потому что DOM ChatGPT и конкретных сайтов может меняться. До такого smoke-test пакет нельзя называть production-validated.

Источник концепции
------------------
Browser Harness by scriby (MIT): condition-based waits, browser-side actions, element proxies, no blind sleeps. Старые NowJS/Express 3/PhantomJS/Fibers/iframe механизмы в этот пакет не переносятся.
