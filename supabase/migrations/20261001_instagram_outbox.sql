-- Private transport queue. No client/partner access and no session credentials.
create table public.pcs_instagram_outbox (
  generation_id uuid primary key references public.pcs_ai_generations(id),
  account_id text not null check (account_id ~ '^[0-9]{1,80}$'),
  thread_id text not null check (thread_id ~ '^[0-9]{1,80}$'),
  recipient_id text not null check (recipient_id ~ '^[0-9]{1,80}$' and recipient_id <> account_id),
  reply_text text not null check (length(btrim(reply_text)) between 1 and 8000),
  status text not null default 'pending' check (status in ('pending','sending','sent','review')),
  claim_request_id uuid unique,
  claim_id uuid,
  job jsonb,
  provider_message_id text check (provider_message_id is null or provider_message_id ~ '^[0-9]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,provider_message_id)
);
alter table public.pcs_instagram_outbox enable row level security;
revoke all on public.pcs_instagram_outbox from public,anon,authenticated;
grant all on public.pcs_instagram_outbox to service_role;
create index pcs_instagram_outbox_pending on public.pcs_instagram_outbox(account_id,created_at) where status='pending';

create function public.pcs_instagram_outbox_claim(p_account text,p_request uuid,p_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.pcs_instagram_outbox%rowtype;
begin
  if p_account !~ '^[0-9]{1,80}$' or p_request is null then raise exception 'invalid_claim'; end if;
  -- Serialize the same request across workers; never issue two jobs for it.
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into o from public.pcs_instagram_outbox where account_id=p_account and claim_request_id=p_request for update;
  if found then
    if o.status='sending' and (o.job->>'expires_at')::bigint > extract(epoch from now())::bigint
       and (p_recipients is null or o.recipient_id=any(p_recipients)) then
      return jsonb_build_object('claim_id',o.claim_id,'job',o.job);
    end if;
    return null;
  end if;
  select q.* into o from public.pcs_instagram_outbox q join public.pcs_ai_generations g on g.id=q.generation_id
   where q.account_id=p_account and q.status='pending' and q.created_at>now()-interval '15 minutes'
     and (p_recipients is null or q.recipient_id=any(p_recipients))
     and g.status='pending_send' and g.policy_decision='auto' and not g.requires_human and g.risk='low'
   order by q.created_at limit 1 for update of q skip locked;
  if not found then return null; end if;
  o.claim_id=gen_random_uuid();
  o.job=jsonb_build_object('generation_id',o.generation_id,'account_id',o.account_id,
    'thread_id',o.thread_id,'recipient_id',o.recipient_id,'text',o.reply_text,'approved',true,
    'expires_at',floor(extract(epoch from now()))::bigint+300);
  update public.pcs_instagram_outbox set status='sending',claim_request_id=p_request,claim_id=o.claim_id,
    job=o.job,updated_at=now() where generation_id=o.generation_id;
  update public.pcs_ai_generations set status='sending',updated_at=now() where id=o.generation_id;
  return jsonb_build_object('claim_id',o.claim_id,'job',o.job);
end $$;

create function public.pcs_instagram_outbox_ack(p_account text,p_generation uuid,p_claim uuid,p_status text,p_message text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare o public.pcs_instagram_outbox%rowtype; g public.pcs_ai_generations%rowtype;
begin
  if p_status not in ('sent','uncertain') or (p_status='sent' and (p_message is null or p_message !~ '^[0-9]{1,80}$'))
    then raise exception 'invalid_ack'; end if;
  select * into o from public.pcs_instagram_outbox where generation_id=p_generation
    and account_id=p_account and claim_id=p_claim for update;
  if not found then raise exception 'claim_not_found'; end if;
  if o.status='sent' then
    if p_status='sent' and o.provider_message_id=p_message then return true; end if;
    raise exception 'ack_conflict';
  end if;
  if o.status not in ('sending','review') then raise exception 'claim_not_active'; end if;
  if p_status='uncertain' then
    update public.pcs_instagram_outbox set status='review',updated_at=now() where generation_id=p_generation;
    update public.pcs_ai_generations set status='failed',next_action='Проверить доставку Instagram; не повторять автоматически',
      updated_at=now() where id=p_generation;
    return true;
  end if;
  select * into g from public.pcs_ai_generations where id=p_generation for update;
  insert into public.pcs_messages(contact_id,direction,text,status,channel,external_message_id,external_chat_id,
    business_connection_id,raw)
  values(g.contact_id,'out',o.reply_text,'sent','instagram','instagrapi:'||o.account_id||':'||p_message,
    'instagrapi:'||o.account_id||':'||o.thread_id,'instagram',
    jsonb_build_object('source','pcs-instagram-outbox','generation_id',p_generation))
  on conflict(channel,external_message_id,direction) do nothing;
  update public.pcs_instagram_outbox set status='sent',provider_message_id=p_message,updated_at=now() where generation_id=p_generation;
  update public.pcs_ai_generations set status='sent',updated_at=now() where id=p_generation;
  update public.pcs_contacts set status='WAITING_CLIENT',next_action='Дождаться ответа клиента'
    where id=g.contact_id and status in ('NEW','QUALIFYING','WAITING_CLIENT','IN_PROGRESS','OFFER_SENT');
  return true;
end $$;
revoke all on function public.pcs_instagram_outbox_claim(text,uuid,text[]) from public,anon,authenticated;
revoke all on function public.pcs_instagram_outbox_ack(text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pcs_instagram_outbox_claim(text,uuid,text[]) to service_role;
grant execute on function public.pcs_instagram_outbox_ack(text,uuid,uuid,text,text) to service_role;
