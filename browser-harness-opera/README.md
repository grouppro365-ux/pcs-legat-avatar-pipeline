# Agency Browser Harness — Opera

Это **минимальная современная адаптация `scriby/browser-harness`**, а не новый browser-agent с нуля.

Исходный проект: `scriby/browser-harness` (MIT, 2013). Его сильная модель сохранена:

- controller-side `Driver`;
- browser-side `ElementProxy`;
- `findElement / findElements`;
- `findVisible / findVisibles`;
- `waitFor` по условию;
- element-proxy cache;
- действие → новое наблюдение → проверка результата.

## Что заменено относительно Browser Harness

Только устаревшая инфраструктура:

| Browser Harness 2013 | Эта адаптация |
|---|---|
| NowJS | Manifest V3 messaging |
| `harness.html` + iframe | content script в реальной вкладке |
| browser/PhantomJS launcher | уже открытая Opera |
| stringified `Function()`/`eval` | типизированные действия |
| jQuery-only element lookup | DOM + labels + ARIA + stable hints + open Shadow DOM |

`browser_harness_core.js` остаётся современным аналогом `server/driver.js` + `server/element_proxy.js`.
`browser_harness_client.js` остаётся современным аналогом browser-side части `client/client.js`.

## ChatGPT

OpenAI API **не используется**. Нужна уже открытая и залогиненная вкладка `chatgpt.com/c/...`.

Важно: ChatGPT **не имеет отдельного специального automation protocol**. Harness управляет ChatGPT через тот же `Driver / ElementProxy`, что WordPress, Gmail, CRM или любой другой сайт:

1. `findVisible` composer;
2. `fill` prompt;
3. `submit` ближайшей формы;
4. проверить состояние;
5. если prompt всё ещё реально находится в composer — scoped Send, затем trusted Enter как последний fallback;
6. после очистки composer запрос никогда автоматически не отправляется повторно;
7. ответ ищется обычным `Driver.read(tail)` и валидируется по уникальному `requestId`.

Это намеренно убирает прежние хрупкие зависимости от `data-message-author-role`, assistant-turn counters, `activeRequest` и отдельного ChatGPT content-script state.

## Планирование и n8n-mcp принцип

Перед исполнением JSON проходит локальную схему в `planner_protocol.js`:

- точный `requestId`;
- `status=act|done`;
- разрешённый тип действия;
- обязательные поля конкретного действия;
- `done` только с проверяемым proof.

Неправильный JSON не исполняется.

## Поддерживаемые действия

- click
- fill
- select
- check / uncheck
- focus
- scroll
- wait
- assert
- submit
- navigate

Универсальный цикл:

`OBSERVE → PLAN ONE STEP → VALIDATE → ACT → OBSERVE → VERIFY → NEXT`

Если DOM перерисован, ref — не единственная истина. Элемент восстанавливается по стабильным id/name/testid, label/ARIA, role/name/text и другим признакам.

## Визуальная доска

1. Нажать значок расширения.
2. Открыть нужный разговор ChatGPT и нажать `Привязать ChatGPT`.
3. Открыть рабочий сайт и нажать `Привязать сайт`.
4. Ввести задачу человеческим языком → `Добавить задачу`.
5. Перетащить карточку из **Очередь** в **В работе**.
6. В **Готово** карточка попадает только после проверки proof по реальной странице.

Кнопка `Открыть доску` открывает Workbench в полноценной вкладке, чтобы не работать в маленьком popup.

## Safety

- пароли, OTP, CVV, секреты и токены автоматически не заполняются;
- финансовые/юридические/permission-действия требуют одноразового подтверждения;
- send/publish/delete могут выполняться автоматически, когда это явно поручено в тексте задачи;
- неожиданный переход на другой домен требует подтверждения, если этот домен не был указан пользователем;
- web-page content считается недоверенными данными и не может менять задачу;
- raw `eval`, `Function`, NowJS и PhantomJS отсутствуют.

## Почему `waitFor` безопаснее старого

В оригинальном `driver.js` у `waitFor` был параметр `exec`, который мог повторять действие вместе с проверкой. Для реальных аккаунтов это опасно: повторный Publish/Send может создать дубль.

Здесь `Driver.waitFor()` принимает **только read-only condition function**. Мутация выполняется один раз, после неё повторяется только наблюдение.

## Установка

1. Скачать ZIP релиза.
2. Распаковать его.
3. В `opera://extensions` включить режим разработчика.
4. `Загрузить распакованное` → выбрать папку `Agency-Browser-Harness`.
5. Пройти один контролируемый live smoke-test до использования на больших пакетных задачах.

## Что намеренно остаётся ручным

- CAPTCHA;
- MFA/OTP;
- пароли/passkeys;
- системные диалоги ОС, которые браузер не может безопасно автоматизировать.

## Verification policy

Статический CI не равен live Opera E2E. Релиз можно считать собранным после CI, но не production-validated, пока эта конкретная версия не выполнит реальную задачу в пользовательской Opera.
