-- Migration: 015_cron_digest.sql
-- Digest semanal: segunda-feira às 9h via pg_cron + pg_net

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-digest') THEN
    PERFORM cron.unschedule('weekly-digest');
  END IF;
END;
$$;

-- Segunda-feira às 9h (UTC+1 Lisboa = 8h UTC)
SELECT cron.schedule(
  'weekly-digest',
  '0 8 * * 1',
  $cron$
    SELECT net.http_post(
      url     := 'https://uwjajsukgdulyvjjeazd.supabase.co/functions/v1/digest',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3amFqc3VrZ2R1bHl2amplYXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQzMzYsImV4cCI6MjA5MzY3MDMzNn0.otpSE_SEKTdDwipT_66Z9ZbBu9X2RBbxs2QOqq6CkFI'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
