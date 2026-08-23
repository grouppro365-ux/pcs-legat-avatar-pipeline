# PCS — архитектура будущих каналов

## Статус
Текущий релиз: Telegram Business only.
Следующий этап: LINE, WhatsApp, Instagram, Facebook — как транспортные адаптеры к тому же ядру PCS.

## Проблема
Нельзя строить отдельную CRM и отдельную AI-логику для каждого мессенджера. Это создаст дубли клиентов, разные правила цен/доступности и четыре несовместимых источника истории.

## Решение
Одна предметная модель PCS:
- клиент;
- диалог;
- сообщение;
- вложение;
- база знаний;
- каталог;
- бронирование;
- цена;
- платёж;
- задача;
- договор;
- аудит.

Каналы отвечают только за приём и доставку сообщений.

## Нормализованное входящее событие
```ts
interface ChannelInboundEvent {
  channel: 'telegram' | 'line' | 'whatsapp' | 'instagram' | 'facebook';
  externalUserId: string;
  externalConversationId: string;
  externalMessageId: string;
  text?: string;
  attachments: NormalizedAttachment[];
  timestamp: string;
  languageHint?: string;
  replyCapabilities: {
    canReply: boolean;
    canTyping: boolean;
    supportsImages: boolean;
    supportsDocuments: boolean;
  };
  raw: unknown;
}
```

## Интерфейс адаптера
Каждый канал реализует:
- verifyWebhook(request)
- normalizeInbound(payload)
- sendText(conversation, text)
- sendMedia(conversation, media)
- sendTyping(conversation)
- downloadAttachment(ref)
- getCapabilities(conversation)

Никакой бизнес-логики PCS внутри адаптера.

## Идентификация клиента
Сейчас контакты каналов временно хранятся в `pcs_contacts`.
Перед подключением второго реального канала выделить таблицу `pcs_contact_identities`:
- id
- contact_id
- channel
- external_user_id
- external_conversation_id
- username/display_name
- phone, если канал его подтверждает
- metadata
- created_at/updated_at

Уникальность: `(channel, external_user_id)`.
Один клиент может иметь несколько идентичностей.
Слияние идентичностей — только по подтверждённому совпадению, не по догадке AI.

## Идемпотентность
Уникальный ключ сообщения: `(channel, external_message_id)`.
Повтор webhook не должен повторно запускать AI или отправлять второй ответ.

## Общий pipeline
Channel adapter
→ normalized event
→ contact resolver
→ message persistence
→ context/memory
→ intent
→ KB + confirmed inventory + pricing
→ policy
→ auto / approval / internal escalation
→ channel adapter send
→ CRM + next action + audit.

## Typing
Typing — capability канала, а не бизнес-логика.
Если канал поддерживает typing, adapter отправляет состояние во время подготовки ответа. Отсутствие typing не влияет на результат.

## Каналы следующего этапа
### LINE
LINE Messaging API. Нужен отдельный channel access token/secret. Поддержка reply/push зависит от условий API и типа аккаунта.

### WhatsApp
Официальный WhatsApp Business Platform / Cloud API. Учитывать окно сообщений и шаблоны, где они требуются правилами Meta.

### Instagram
Instagram Messaging API через Meta. Учитывать разрешённые типы аккаунтов, conversation permissions и ограничения ответов.

### Facebook
Messenger Platform через Meta Pages. Общий Meta adapter может переиспользовать auth/webhook инфраструктуру, но channel identity остаётся отдельной.

## Админка
Не создавать четыре новых раздела в основном меню.
`Ещё → Подключения → Каналы`:
- Telegram — подключён / состояние;
- LINE — следующий этап;
- WhatsApp — следующий этап;
- Instagram — следующий этап;
- Facebook — следующий этап.

Пока канал не реализован, не показывать fake connect button. Можно показывать только информационную карточку «Не подключён / следующий этап» без действия.

## Общая карточка клиента
Показывать подтверждённые контакты:
- телефон;
- WhatsApp;
- LINE;
- Telegram;
- Instagram;
- Facebook;
- предпочтительный канал.

Предпочтительный канал не означает автоматическое разрешение на outbound: adapter обязан проверять capability/policy канала.

## Что не делать сейчас
- не подключать реальные LINE/Meta/WhatsApp credentials;
- не делать отдельные CRM;
- не копировать Telegram Business-specific поля в общую бизнес-логику;
- не показывать неработающие кнопки подключения;
- не менять Definition of Done текущего Telegram-релиза.

## Критерии готовности архитектуры к следующему этапу
1. Бизнес-логика AI не вызывает Telegram API напрямую вне Telegram adapter/send layer.
2. Клиент и сделка не зависят от Telegram ID как первичного бизнес-ключа.
3. Сообщения имеют channel + external message identity.
4. Policy engine возвращает решение независимо от канала.
5. Pricing, inventory, booking и contracts полностью channel-agnostic.
6. Новый adapter можно добавить без копирования CRM/AI/KB логики.

## Критерий текущего релиза
Telegram Business E2E остаётся обязательным и должен пройти до начала фактического подключения других каналов.
