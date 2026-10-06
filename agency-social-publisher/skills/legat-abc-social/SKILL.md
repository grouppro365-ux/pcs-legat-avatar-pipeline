---
name: legat-abc-social
description: Operate Legat ABC social media across Instagram, Facebook, Telegram, VK, Dzen and TenChat: plan channel-native content from confirmed/live listing facts, generate or reuse media, create AI or deterministic real-photo Reels, draft/schedule/publish through Agency Social Publisher, coordinate partner distribution, and review analytics without inventing listing data.
version: 0.2.0
language: ru
---

# Legat ABC Social

Используй этот навык для полного цикла соцсетей Legat ABC.

## Главная воронка

предложение → карточка Legat ABC → контент → дистрибуция → переход → обращение → ответственный → результат

## Перед созданием контента

1. Если пользователь дал ссылку Legat ABC, сначала используй `read_legat_listing` или `plan_legat_social_content` с `sourceUrl`.
2. Если изменчивые коммерческие факты не подтверждены, не придумывай их.
3. Для цены, availability, года, пробега, площади, срока, локации и условий источником истины является текущая карточка или явно подтверждённые данные пользователя.
4. Если есть `fact_gaps`, останови публикацию и запроси только действительно недостающие факты.

## Контент-микс

- 45% реальные предложения;
- 20% подборки и сравнения;
- 15% полезность и доверие;
- 10% партнёры и supply;
- 10% сама платформа.

Если 3 из последних 5 материалов рассказывают о Legat ABC как о бренде, следующий материал должен быть про реальное предложение, сравнение или практическую пользу.

## Каналы

### Instagram
Discovery-first. Reels для охвата, carousel для сохранений/сравнения, Stories для ежедневной жизни каталога. Глобальный визуал может быть коротким EN. Не превращай caption в 12 длинных копий без необходимости.

### Facebook
Локальная дистрибуция, группы, обсуждение, партнёрские репосты. Адаптируй hook и текст; не копируй Instagram дословно.

### Telegram
Быстрые конкретные предложения и обновления. Если известны модель, район, категория или цена — называй их, а не используй пустой кликбейт.

### VK
Русскоязычный reach, сообщества, Clips, подборки, опросы. Не делай зеркало Facebook.

### Дзен
Evergreen, поиск и рекомендации: руководства, сравнения и объясняющие материалы, связанные с актуальными карточками. Текущий publishing route — выделенный Telegram source channel, настроенный на Dzen crossposting. После публикации в Telegram не утверждай, что материал появился в Дзене, пока это не проверено.

### TenChat
B2B: партнёры, поставщики, кейсы компаний, развитие рынков, упаковка каталогов. Публикация идёт через явно настроенный secondary bridge; если он не настроен, оставляй материал draft/ready.

## Языки

Операционные локали: RU, EN, PL, ES, ZH, JA, KO, TH, AR, FR, DE, KK.

12 локалей сайта не означают 12 длинных переводов каждого поста.

- global Instagram: короткий EN на визуале + короткие локализации caption только когда пост действительно глобальный;
- market-specific: язык целевого рынка + при необходимости короткий EN bridge;
- RU Telegram / VK / Дзен / TenChat: естественный русский.

## Humanize

Удаляй:
- «уникальная возможность» без фактической причины;
- «идеальное решение»;
- «откройте для себя»;
- пресс-релизный тон;
- бессмысленные тройки;
- повтор одной мысли разными словами;
- искусственную рекламную восторженность.

Предпочитай конкретную ситуацию, факты, одну мысль и один CTA.

## Fact/Safety gate

Нельзя:
- придумывать цену, наличие, характеристики, партнёра, рейтинг, отзывы или статистику;
- обещать «100% безопасную сделку», «без риска», «гарантированно проверено»;
- изображать Legat ABC как бесконтрольную instant-publishing доску;
- менять факты карточки ради красивого текста.

## Визуал

Текущий social-style Legat ABC:
- white / off-white;
- very pale cool blue;
- deep navy;
- bright clean blue;
- cyan secondary;
- coral только для риска/предупреждения;
- реальные объекты;
- много воздуха;
- editorial marketplace.

Избегать по умолчанию:
- black & gold;
- фиолетово-синего AI gradient;
- fake UI, fake ratings, fake prices, fake statistics;
- огромного логотипа;
- банальных рукопожатий и глобусов.

## Ролики

Есть два отдельных режима — не смешивай их без причины.

### AI-video
Используй `start_social_video_generation` для концептуальных/UGC/b-roll роликов, где допустима генерация. После завершения используй `finish_social_video_to_media`.

### Real-photo Reel
Для конкретной машины, квартиры, товара или другого предложения, когда внешний вид объекта нельзя менять, предпочитай `render_reel_from_real_photos`.

Он:
- берёт только approved/allowlisted реальные фото;
- собирает вертикальный MP4 через FFmpeg;
- добавляет только переданные factual title/subtitle/footer;
- не дорисовывает и не меняет сам объект;
- складывает готовый MP4 в Postiz media.

Если есть уже готовый ролик — не генерируй новый, используй `import_social_media_from_url`.

## Рабочий порядок

1. `list_social_accounts`, если integration IDs ещё неизвестны.
2. Прочитать current source / факты.
3. `plan_legat_social_content`.
4. Если нужен новый визуал — `generate_social_image`.
5. Если нужен AI-ролик — `start_social_video_generation`, затем `get_social_video_status` и `finish_social_video_to_media`.
6. Если нужен Reel из реальных фото без изменения объекта — `render_reel_from_real_photos`.
7. Если медиа уже существует — `import_social_media_from_url` или загрузка через API.
8. Для новых/изменчивых коммерческих фактов по умолчанию `create_social_draft`.
9. Если пользователь явно просит расписание — `schedule_social_post`.
10. Если пользователь явно просит публикацию сейчас — `publish_social_post_now`.
11. Если тексты по площадкам различаются, используй `publish_channel_pack`, а не один текст во все сети.
12. Для Дзена используй `publish_dzen_source_via_telegram` только при настроенном crossposting source.
13. Для TenChat используй `publish_tenchat_via_bridge` только при настроенном bridge.
14. После публикации используй аналитику и не оптимизируй стратегию только под likes/followers.

## Completion gate

Не говори «опубликовано» только потому, что запрос отправлен. Для public action нужен подтверждённый результат Postiz/bridge и, где возможно, фактический platform URL/status.
