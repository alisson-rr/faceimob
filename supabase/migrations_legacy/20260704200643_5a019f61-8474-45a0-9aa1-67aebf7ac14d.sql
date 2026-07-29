
ALTER TABLE public.brokers
  ADD COLUMN IF NOT EXISTS login_password_plain text,
  ADD COLUMN IF NOT EXISTS login_email_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_requested_at date,
  ADD COLUMN IF NOT EXISTS badge_delivered_at date;
