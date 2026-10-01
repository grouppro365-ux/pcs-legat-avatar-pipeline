-- The private outbox already applies the PCS reply policy before queueing.
-- Preserve the legacy postprocessor for Telegram and every other transport.
create or replace function public.pcs_hold_auto_generation_for_postprocess()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if new.business_connection_id='instagram'
     and new.policy_reason='local_instagram_outbox'
     and new.policy_decision='auto' and new.status='pending_send'
     and new.risk='low' and not new.requires_human and new.confidence>=0.9
     and new.model<>'safe-fallback'
     and exists(select 1 from public.pcs_messages m where m.id=new.source_message_id
       and m.channel='instagram' and m.direction='in'
       and m.external_message_id ~ '^instagrapi:[0-9]+:[0-9]+$') then
    return new;
  end if;
  if new.business_connection_id is not null and new.source_message_id is not null
     and new.policy_decision='auto' and new.status='pending_send' then
    new.status := 'approval_required';
    new.policy_reason := coalesce(new.policy_reason,'auto') || '|postprocess_v9';
  end if;
  return new;
end $$;
