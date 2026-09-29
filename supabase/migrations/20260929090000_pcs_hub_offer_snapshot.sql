-- Keep the exact vehicle order and quoted terms alongside the generated reply.
-- A later customer choice must refer to this snapshot, never to a fresh catalog search.
alter table public.pcs_ai_generations
  add column if not exists offer_snapshot jsonb;

comment on column public.pcs_ai_generations.offer_snapshot is
  'Versioned customer offer snapshot for the Conversation Hub; set when the reply is generated.';
