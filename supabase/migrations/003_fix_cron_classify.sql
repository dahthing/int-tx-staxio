-- Migration: 003_fix_cron_classify.sql
-- Corrige o cron job classify-inbox para usar anon key (valor público)

SELECT cron.unschedule('classify-inbox');

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
