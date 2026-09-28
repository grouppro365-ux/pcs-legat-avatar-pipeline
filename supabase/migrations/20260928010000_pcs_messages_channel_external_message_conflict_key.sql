-- PostgREST upsert needs a non-partial unique index to infer ON CONFLICT.
-- PostgreSQL still permits multiple NULL external IDs, as before.
create unique index if not exists pcs_messages_channel_external_message_conflict_key
  on public.pcs_messages (channel, external_message_id, direction);
