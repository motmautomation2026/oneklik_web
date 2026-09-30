-- 0024_profiles_phone.sql
-- Mandatory mobile number, collected at onboarding. Unverified for now — no
-- OTP flow yet — so it is a plain user-editable profile field (the existing
-- profiles_update_own policy covers it). Stored in E.164 (e.g. +919876543210)
-- so a future OTP/verification step can use it as-is.
--
-- Deliberately no unique index: without verification, uniqueness would let
-- anyone squat a real person's number and lock its owner out of signing up.
-- Add uniqueness together with verification (a phone_verified_at column).

begin;

alter table profiles
  add column if not exists phone text;

alter table profiles
  drop constraint if exists profiles_phone_e164;
alter table profiles
  add constraint profiles_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

commit;
