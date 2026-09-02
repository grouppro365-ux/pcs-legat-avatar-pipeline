# PCS AI Operator — Runtime v7 QA Gate

## P0 acceptance

A release is not complete until a real Telegram Business message completes the whole path:

`incoming business_message -> webhook -> pcs-tg-gateway -> pcs-business-runtime-v7 -> pcs_messages/pcs_contacts -> policy/AI -> Telegram sendMessage -> outbound pcs_messages row`

Do not call the release complete from deployment status alone.

## Multilingual routing

Current-message text has priority over Telegram `language_code` and historical CRM language.

Required language cases:

- RU: `Здравствуйте, нужна квартира на декабрь.` -> `housing_rent`
- EN: `Hello, I need an apartment in December.` -> `housing_rent`
- IT: `Salve, ho bisogno di un alloggio per dicembre.` -> `housing_rent`
- ES: `Hola, necesito un apartamento para diciembre.` -> `housing_rent`
- FR: `Bonjour, j'ai besoin d'un appartement pour décembre.` -> `housing_rent`
- DE: `Hallo, ich brauche eine Wohnung im Dezember.` -> `housing_rent`
- TH: housing/car/bike/visa keywords must remain supported.

For a rental request missing city or exact dates, the operator must send a deterministic qualification question in the language of the current message when auto-send is enabled.

## Topic switching

A new topic must not inherit city, budget, selected catalog item, dates or intent from a prior unrelated topic.

Explicit short follow-ups (`1`, `thanks`, `grazie`, `спасибо`, etc.) may inherit the current topic.

## Grounding gate

For `visa`, `bank`, `legal`, `medical`, `dentistry`, and `emergency`:

- no concrete factual answer unless supported by active `customer_safe` + `auto_answer_allowed` knowledge;
- if confirmed knowledge is absent, send only a safe localized hold/checking message and create an operator task;
- never invent financial requirements, document lists, prices, deadlines, contacts, or legal/medical claims.

## Catalog safety

Rental/sale answers may use only confirmed available catalog items. When dates are supplied, use booking quote/conflict checks. Payment details may be sent only when the selected catalog item explicitly allows it.

## Phone intelligence adoption

Reference reviewed: `spider863644/PhoneNumber-OSINT` (MIT). Reuse only the non-invasive metadata concepts based on libphonenumber-style parsing:

- normalize to E.164;
- validate number structure;
- derive country/region where supported;
- derive timezone/carrier only from deterministic numbering metadata where supported;
- never scrape private accounts, bypass platform access controls, or infer identity from a number;
- store provenance and confidence for derived phone metadata;
- run only on phone numbers already supplied to PCS or lawfully present in CRM.

Phone enrichment is P1 and must not delay the P0 Telegram Business E2E pass.

## Regression: greeting and follow-up date

1. Customer: «Здравствуйте. Нужна машина в Паттайе, на месяц».
   Expected: the reply starts with a greeting and asks only for the missing start date.
2. Customer: «С 11 сентября».
   Expected: the date is stored as an answer to the previous question; the bot must not ask «С какой даты?» again.
3. The next reply must either show confirmed matching cars or say that PCS will check availability and return in the same chat.

## Regression: contextual slots and topic switching

1. Start a housing request, then reply in separate messages: «Паттайя», «30 000 бат», «2».
   Expected: the final answer fills the rooms field and the bot advances instead of repeating the rooms question.
2. Start a car request, switch to a housing request, then say «Вернёмся к машине».
   Expected: car and housing facts remain isolated; the car scenario resumes with its saved facts.
3. If the same missing-field question would be sent twice in a row, send a concrete format hint instead of repeating it verbatim.
4. Switch from housing to transfer or visa, then answer with a short follow-up.
   Expected: the short follow-up remains delegated to the active service scenario and is never consumed by the previous housing scenario.
