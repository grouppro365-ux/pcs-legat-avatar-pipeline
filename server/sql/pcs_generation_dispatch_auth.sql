-- Preserve existing dispatch routes and trigger behavior; use the existing internal secret.
create or replace function public.pcs_dispatch_generation_postprocess_v9()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin
 if new.policy_decision='auto' and new.status='approval_required' and coalesce(new.policy_reason,'') like '%postprocess_v9%' then
  if new.intent in ('visa','bank','legal','medical','dentistry','emergency') then
   perform net.http_post(
    url := 'https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-generation-postprocess-v9',
    headers := jsonb_build_object('content-type','application/json','x-pcs-internal-secret',public.pcs_secret_get('internal_retry_secret')),
    body := jsonb_build_object('generation_id',new.id));
  else
   perform net.http_post(
    url := 'https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-generation-humanize-v10',
    headers := jsonb_build_object('content-type','application/json','x-pcs-internal-secret',public.pcs_secret_get('internal_retry_secret')),
    body := jsonb_build_object('generation_id',new.id));
  end if;
 end if;
 return new;
end $function$;
