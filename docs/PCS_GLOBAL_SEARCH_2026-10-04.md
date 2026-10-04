# PCS operator search

Extends the existing Mini App home search and authenticated manager. Searches actual Neon contacts, catalog, applications, partners, and message text; results no longer depend on the first 500 loaded CRM records. Each source has 20 results per page and a lookahead flag. Matching uses a bound literal substring, not SQL wildcard interpolation. Each source reports failures independently.

Clients and messages open their existing CRM conversation. Catalog results open the existing catalog editor after a fresh detail read. Application and partner results show a narrow read-only summary. No new canonical CRM, database, cabinet, or entity is introduced. Separate deal/content/email sources are not claimed as implemented.

Verified: 234 automated tests, including authorization/method guards, query validation, literal hostile input, source isolation, escaped output, stale responses, and paging; all five actual database SELECTs returned HTTP 200 (pg_net 174363, 174366–174369). Search is read-only; no customer messages sent. Original logo SHA256 remains 1c11d5379f76a45e54f34110c206ef3c649d9286f9bd9ea61d4cd1345d68ff56.

Native Telegram visual acceptance and the complete master specification remain unverified. This release closes the supported search scenario, not the entire project.
