CREATE FUNCTION public.pcs_instagram_sync_followup_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
BEGIN
 IF OLD.status NOT IN ('sending','review') OR NEW.claim_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.status='sent' AND NEW.provider_message_id ~ '^[0-9]{1,80}$' THEN
   UPDATE public.pcs_customer_followups f
     SET status='sent',sent_message_ids=jsonb_build_array(NEW.provider_message_id),
       completed_at=now(),updated_at=now(),last_error=null
     FROM public.pcs_ai_generations g
     WHERE f.id=NEW.generation_id AND g.id=f.id AND g.model='car-rental-followup-v1'
       AND g.business_connection_id='instagram' AND f.business_connection_id='instagram'
       AND g.contact_id=f.contact_id AND g.source_message_id=f.source_message_id
       AND (f.status='queued' OR (f.status='failed' AND f.last_error LIKE 'needs_reconciliation:%'));
 ELSIF NEW.status='review' THEN
   UPDATE public.pcs_customer_followups f
     SET status='failed',updated_at=now(),last_error='needs_reconciliation:instagram_delivery_uncertain'
     FROM public.pcs_ai_generations g
     WHERE f.id=NEW.generation_id AND g.id=f.id AND g.model='car-rental-followup-v1'
       AND g.business_connection_id='instagram' AND f.business_connection_id='instagram'
       AND g.contact_id=f.contact_id AND g.source_message_id=f.source_message_id AND f.status='queued';
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.pcs_instagram_sync_followup_delivery() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pcs_instagram_followup_delivery_trg
AFTER UPDATE OF status,provider_message_id ON public.pcs_instagram_outbox
FOR EACH ROW EXECUTE FUNCTION public.pcs_instagram_sync_followup_delivery();
