-- Server-only atomic Instagram follow-up enqueue. Does not deliver messages.
CREATE FUNCTION public.pcs_instagram_followup_enqueue(p_followup uuid,p_answer text,p_offer jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
 f public.pcs_customer_followups%ROWTYPE;
 g public.pcs_ai_generations%ROWTYPE;
 m public.pcs_messages%ROWTYPE;
 c public.pcs_contacts%ROWTYPE;
 q public.pcs_instagram_outbox%ROWTYPE;
 child public.pcs_ai_generations%ROWTYPE;
 cfg jsonb; opt jsonb; canonical jsonb; options jsonb:='[]'::jsonb;
 normalized text;
BEGIN
 SELECT * INTO f FROM public.pcs_customer_followups WHERE id=p_followup FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'followup_missing'; END IF;
 SELECT * INTO q FROM public.pcs_instagram_outbox WHERE generation_id=f.id;
 IF FOUND THEN
   RETURN jsonb_build_object('queued',true,'generation_id',f.id,'delivery_status',q.status);
 END IF;
 IF f.status<>'processing' OR f.kind<>'car_rent' OR f.business_connection_id IS DISTINCT FROM 'instagram' THEN
   RAISE EXCEPTION 'followup_not_eligible';
 END IF;
 SELECT * INTO g FROM public.pcs_ai_generations WHERE id=f.generation_id;
 IF NOT FOUND OR g.status<>'sent' OR g.intent<>'car_rent'
   OR g.business_connection_id IS DISTINCT FROM 'instagram'
   OR g.contact_id IS DISTINCT FROM f.contact_id OR g.source_message_id IS DISTINCT FROM f.source_message_id THEN
   RAISE EXCEPTION 'original_generation_invalid';
 END IF;
 SELECT * INTO m FROM public.pcs_messages WHERE id=f.source_message_id;
 IF NOT FOUND OR m.channel<>'instagram' OR m.direction<>'in' OR m.contact_id IS DISTINCT FROM f.contact_id THEN
   RAISE EXCEPTION 'original_source_invalid';
 END IF;
 SELECT * INTO c FROM public.pcs_contacts WHERE id=f.contact_id FOR UPDATE;
 IF NOT FOUND OR c.followup_enabled IS DISTINCT FROM true OR c.status='OPTED_OUT' THEN
   RAISE EXCEPTION 'contact_ineligible';
 END IF;
 IF EXISTS(SELECT 1 FROM public.pcs_messages newer WHERE newer.contact_id=f.contact_id
   AND newer.direction='in' AND (newer.created_at,newer.id)>(m.created_at,m.id)) THEN
   RAISE EXCEPTION 'followup_superseded';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pcs_settings WHERE id='main' AND auto_send)
   OR NOT EXISTS(SELECT 1 FROM public.pcs_channel_connections WHERE channel='instagram'
     AND enabled AND status='active' AND public_config->>'transport'='instagrapi'
     AND public_config->>'reply_mode'='auto') THEN
   RAISE EXCEPTION 'instagram_auto_disabled';
 END IF;
 SELECT * INTO q FROM public.pcs_instagram_outbox WHERE generation_id=g.id AND status='sent'
   AND provider_message_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'original_delivery_unproven'; END IF;
 cfg:=public.pcs_secret_get('channel_instagram_local_bridge')::jsonb;
 IF cfg->>'enabled' IS DISTINCT FROM 'true' OR cfg->>'outgoing_enabled' IS DISTINCT FROM 'true'
   OR cfg->>'account_id' IS DISTINCT FROM q.account_id
   OR m.external_chat_id IS DISTINCT FROM 'instagrapi:'||q.account_id||':'||q.thread_id
   OR m.external_message_id !~ ('^instagrapi:'||q.account_id||':[0-9]+$') THEN
   RAISE EXCEPTION 'instagram_route_disabled_or_invalid';
 END IF;
 IF cfg ? 'outgoing_since' AND m.created_at<(cfg->>'outgoing_since')::timestamptz THEN
   RAISE EXCEPTION 'source_before_outgoing_activation';
 END IF;
 IF jsonb_typeof(cfg->'pilot_recipient_ids')='array' AND jsonb_array_length(cfg->'pilot_recipient_ids')>0
   AND NOT (cfg->'pilot_recipient_ids' @> jsonb_build_array(q.recipient_id)) THEN
   RAISE EXCEPTION 'recipient_not_enabled';
 END IF;
 IF p_answer IS NULL OR length(btrim(p_answer)) NOT BETWEEN 1 AND 8000
   OR jsonb_typeof(p_offer) IS DISTINCT FROM 'object' OR p_offer->'version' IS DISTINCT FROM '1'::jsonb
   OR p_offer->>'intent' IS DISTINCT FROM 'car_rent'
   OR coalesce(p_offer->>'start_date','') !~ '^\d{4}-\d{2}-\d{2}$'
   OR coalesce(p_offer->>'end_date','') !~ '^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(p_offer->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_public_offer'; END IF;
 IF (p_offer->>'end_date')::date <= (p_offer->>'start_date')::date
   OR jsonb_array_length(p_offer->'options') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'invalid_offer_range'; END IF;
 FOR opt IN SELECT value FROM jsonb_array_elements(p_offer->'options') LOOP
   IF jsonb_typeof(opt->'total_before_extras') IS DISTINCT FROM 'number'
     OR (opt->>'total_before_extras')::numeric<=0
     OR coalesce(opt->>'currency','') !~ '^[A-Z]{3}$'
     OR length(coalesce(opt->>'title','')) NOT BETWEEN 1 AND 500
     OR coalesce(opt->>'catalog_item_id','') !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'invalid_offer_option'; END IF;
   PERFORM (opt->>'catalog_item_id')::uuid;
   IF opt->'security_deposit_thb' IS DISTINCT FROM 'null'::jsonb AND
     (jsonb_typeof(opt->'security_deposit_thb') IS DISTINCT FROM 'number' OR (opt->>'security_deposit_thb')::numeric<0) THEN
     RAISE EXCEPTION 'invalid_security_deposit';
   END IF;
   options:=options||jsonb_build_array(jsonb_build_object('catalog_item_id',opt->>'catalog_item_id',
     'title',opt->>'title','total_before_extras',opt->'total_before_extras','currency',opt->>'currency',
     'security_deposit_thb',opt->'security_deposit_thb'));
 END LOOP;
 canonical:=jsonb_build_object('version',1,'intent','car_rent','start_date',p_offer->>'start_date',
   'end_date',p_offer->>'end_date','options',options);
 IF canonical IS DISTINCT FROM p_offer THEN RAISE EXCEPTION 'non_public_offer_fields'; END IF;
 normalized:=regexp_replace(replace(replace(p_answer,'—','-'),'–','-'),'[[:space:]]{2,}',' ','g');
 INSERT INTO public.pcs_ai_generations(id,contact_id,source_message_id,provider,model,intent,confidence,risk,
   requires_human,answer,policy_decision,policy_reason,status,business_connection_id,source_text,offer_snapshot)
 VALUES(f.id,f.contact_id,f.source_message_id,'deterministic','car-rental-followup-v1','car_rent',1,'low',false,
   p_answer,'auto','local_instagram_outbox','pending_send','instagram',m.text,canonical)
 RETURNING * INTO child;
 IF child.status IS DISTINCT FROM 'pending_send' OR child.policy_decision IS DISTINCT FROM 'auto'
   OR child.policy_reason IS DISTINCT FROM 'local_instagram_outbox' OR child.answer IS DISTINCT FROM normalized
   OR child.offer_snapshot IS DISTINCT FROM canonical THEN RAISE EXCEPTION 'generation_policy_changed_offer'; END IF;
 INSERT INTO public.pcs_instagram_outbox(generation_id,account_id,thread_id,recipient_id,reply_text,status)
 VALUES(child.id,q.account_id,q.thread_id,q.recipient_id,child.answer,'pending');
 UPDATE public.pcs_customer_followups SET status='queued',updated_at=now(),last_error=null WHERE id=f.id;
 RETURN jsonb_build_object('queued',true,'generation_id',child.id);
END $function$;
REVOKE ALL ON FUNCTION public.pcs_instagram_followup_enqueue(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pcs_instagram_followup_enqueue(uuid,text,jsonb) TO service_role;
