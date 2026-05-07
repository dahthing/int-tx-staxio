-- Migration: 002_cron_classify.sql
-- Cron job: polling da inbox a cada 5 minutos via pg_cron + pg_net
-- Substitui webhook Drive Push (requer domínio verificado, impossível em *.supabase.co)

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotente: remove job anterior se existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'classify-inbox') THEN
    PERFORM cron.unschedule('classify-inbox');
  END IF;
END;
$$;

-- Agenda /classify a cada 5 minutos
-- Usa anon key (público) — Edge Functions verificam via JWT do Supabase
SELECT cron.schedule(
  'classify-inbox',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://uwjajsukgdulyvjjeazd.supabase.co/functions/v1/classify',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3amFqc3VrZ2R1bHl2amplYXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQzMzYsImV4cCI6MjA5MzY3MDMzNn0.otpSE_SEKTdDwipT_66Z9ZbBu9X2RBbxs2QOqq6CkFI'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
