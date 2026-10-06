CREATE FUNCTION public.pcs_instagram_delivery_eligible(p_generation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
 SELECT EXISTS(
   SELECT 1 FROM public.pcs_instagram_outbox q
   JOIN public.pcs_ai_generations g ON g.id=q.generation_id
   JOIN public.pcs_contacts c ON c.id=g.contact_id
   JOIN public.pcs_messages m ON m.id=g.source_message_id AND m.contact_id=c.id
   JOIN public.pcs_settings s ON s.id='main' AND s.auto_send
   JOIN public.pcs_channel_connections ch ON ch.channel='instagram' AND ch.enabled AND ch.status='active'
   WHERE q.generation_id=p_generation AND g.business_connection_id='instagram'
     AND g.status IN ('pending_send','sending') AND g.policy_decision='auto'
     AND g.risk='low' AND NOT g.requires_human AND c.status<>'OPTED_OUT'
     AND ch.public_config->>'transport'='instagrapi' AND ch.public_config->>'reply_mode'='auto'
     AND m.channel='instagram' AND m.direction='in'
     AND m.external_chat_id='instagrapi:'||q.account_id||':'||q.thread_id
     AND m.external_message_id ~ ('^instagrapi:'||q.account_id||':[0-9]+$')
     AND NOT EXISTS(SELECT 1 FROM public.pcs_messages newer WHERE newer.contact_id=c.id
       AND newer.direction='in' AND (newer.created_at,newer.id)>(m.created_at,m.id))
     AND (g.model IS DISTINCT FROM 'car-rental-followup-v1' OR
       (c.followup_enabled AND EXISTS(SELECT 1 FROM public.pcs_customer_followups f
         WHERE f.id=g.id AND f.status='queued' AND f.contact_id=c.id AND f.source_message_id=m.id)))
 );
$function$;
REVOKE ALL ON FUNCTION public.pcs_instagram_delivery_eligible(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pcs_instagram_delivery_eligible(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.pcs_instagram_outbox_claim(p_account text, p_request uuid, p_recipients text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.pcs_instagram_outbox%rowtype; cfg jsonb;
begin
  if p_account !~ '^[0-9]{1,80}$' or p_request is null then raise exception 'invalid_claim'; end if;
  cfg:=public.pcs_secret_get('channel_instagram_local_bridge')::jsonb;
  IF cfg->>'enabled' IS DISTINCT FROM 'true' OR cfg->>'outgoing_enabled' IS DISTINCT FROM 'true'
    OR cfg->>'account_id' IS DISTINCT FROM p_account THEN RETURN null; END IF;
  -- Serialize the same request across workers; never issue two jobs for it.
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into o from public.pcs_instagram_outbox where account_id=p_account and claim_request_id=p_request for update;
  if found then
    if o.status='sending' and public.pcs_instagram_delivery_eligible(o.generation_id) and (o.job->>'expires_at')::bigint > extract(epoch from now())::bigint
       and (p_recipients is null or o.recipient_id=any(p_recipients)) then
      return jsonb_build_object('claim_id',o.claim_id,'job',o.job);
    end if;
    return null;
  end if;
  select q.* into o from public.pcs_instagram_outbox q join public.pcs_ai_generations g on g.id=q.generation_id
   where q.account_id=p_account and q.status='pending' and q.created_at>now()-interval '15 minutes'
     and (p_recipients is null or q.recipient_id=any(p_recipients))
     and public.pcs_instagram_delivery_eligible(g.id)
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
end $function$
