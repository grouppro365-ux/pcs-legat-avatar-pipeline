-- Existing manager's authenticated public scanner. Sending/outreach is not enabled.
-- Re-running cron.schedule with this name updates the same named job.
select cron.schedule('pcs-telegram-prospecting-public','*/15 * * * *',$job$
 select net.http_post(
  url := 'https://nnlzgertmmxuteozoeel.supabase.co/functions/v1/pcs-manager-live2?op=prospecting-worker',
  headers := jsonb_build_object('Content-Type','application/json','x-pcs-internal-secret',public.pcs_secret_get('internal_retry_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
$job$);
