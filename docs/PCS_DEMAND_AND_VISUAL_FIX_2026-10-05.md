# PCS: demand classification and editor correction

## Corrected behavior

The catalog editor now uses associated field labels, existing field/button tokens, a short sheet heading, a separate wrapping object title, vertical text areas and a responsive action grid. The existing pricing/deposit PATCH contract is preserved.

The external model no longer has the sole authority to qualify a lead. An independent conservative gate requires a customer-demand expression, the correct object and transaction, and a literal demand quotation. Supplier listings, promotional questions, motorcycle-only requests, closed needs and housing rentals cannot become the two supported lead directions. Unknown wording/languages remain review candidates. Examples include Russian, English and Thai; no regex gate is claimed to be a complete natural-language model.

| Wording | Result |
| --- | --- |
| Хочу купить кондо для сдачи | Property purchase candidate |
| Кто сдаёт авто на месяц? | Car rental candidate |
| Ищу жильё на зимовку / looking for an apartment to rent | Outside the two supported directions |
| Ищу квартиру | Review: transaction unspecified |
| Новый пентхаус, удобства, цена, контакт | Supplier listing |
| Если нужна машина, пишите нам | Supplier marketing |

Earlier qualified records on an older policy are included in bounded reclassification. Every separated public history page is checked against the original message text, identity and microsecond revision before an audited update. No cursor or customer contact changes are made by reclassification.

Competitor sources use the existing source table (`topic=competitor`), the same scheduled scanner and classifications, and a bound SQL filter before pagination. Adding an existing source updates this tag. Four verified public competitor communities were added to the existing CRM: iproperty_phuket, ibg_property, phuket_thailand_nedvizhimost, PhuketPropertySale. Public channel broadcasts are supplier content unless actual client demand is demonstrated. Reading comments or groups without public history and messaging authors still requires the dedicated Telegram user session; this release does not claim those flows are connected.

The dashboard reads authoritative aggregated CRM and business counts and shows failed sections as unavailable. Read-only notification browsing and operational application details are available. No notification delivery or acknowledgment is fabricated.

## Verification

- 348 Node regressions passed, including adversarial model labels for listings, demand examples in three languages, separated history pages, source filtering, admin authorization, stale responses and dashboard counts.
- Both operational aggregation queries returned HTTP 200 from the existing Neon databases. At the check: 2 contacts, 155 catalog items, 128 published/approved/available items, 4 active bookings. No customer fixture or test message was written.
- Existing manager deployment v26 preserves all previous modules and authentication; no new function or plan change.
- Four source-add statements returned HTTP 200 and audited existing-source records.
- First old-policy reclassification returned HTTP 200: 2 rejected, 0 qualified, 0 sent. Second rollout run returned HTTP 200: 4 checked, 3 rejected and 1 review. All five previously qualified supplier ads are now outside the qualified list. The scheduled scan read 20 messages with 9 rejected, 1 review, 0 qualified and 0 errors.
- Schedule remains the owner-approved 15-minute public scanner; customer Follow-up remains disabled.
- Secure browser authentication succeeded in the PR31 preview. The same LTC-008 editor from the owner screenshot was opened and captured; fields, title and save/photo actions render correctly. Authoritative dashboard counters were observed in the signed-in UI. A visual check found the prospect checkbox inheriting text-field sizing and bare filter selects; scoped controls/layout were added. The 360px responsive harness keeps ordinary PCS authentication. Main production UI publication is blocked by automatic approval review requiring explicit approval to merge PR31. No alternative deployment path is used.

Gamification is not implemented. The full master backlog remains open beyond the verified scope of this release.
