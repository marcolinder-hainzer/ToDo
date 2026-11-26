-- =============================================================================
-- Erinnerungen: prüft jede Minute, ob Erinnerungen fällig sind, und ruft dann
-- die Edge Function "send-reminders" auf (die die Push-Nachrichten verschickt).
--
-- Vor dem Ausführen ersetzen:
--   __PROJECT_URL__  -> z. B. https://abcdefghijkl.supabase.co
--   __CRON_SECRET__  -> derselbe Wert wie das Secret CRON_SECRET der Edge Functions
-- =============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'todo-reminders';

select cron.schedule(
  'todo-reminders',
  '* * * * *',
  $job$
  select net.http_post(
    url     := '__PROJECT_URL__/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  where exists (
    select 1 from public.todos
     where reminder_at <= now() and reminder_sent_at is null
       and not reminder_dismissed and completed_at is null
  );
  $job$
);
