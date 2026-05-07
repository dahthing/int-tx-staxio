-- Migration: 009_cron_move.sql
-- Cron job independente para /move a cada 5 minutos
-- Garante que items pending são processados mesmo que o classify
-- não tenha encontrado ficheiros novos nessa ronda.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'move-pending') THEN
    PERFORM cron.unschedule('move-pending');
  END IF;
END;
$$;

SELECT cron.schedule(
  'move-pending',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://uwjajsukgdulyvjjeazd.supabase.co/functions/v1/move',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3amFqc3VrZ2R1bHl2amplYXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTQzMzYsImV4cCI6MjA5MzY3MDMzNn0.otpSE_SEKTdDwipT_66Z9ZbBu9X2RBbxs2QOqq6CkFI'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
