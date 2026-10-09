-- Migration 44: terms consent, age band and guardian consent (safe to re-run, no dependencies).
-- Draft for legal review: the attorney must confirm what must be stored and for how long.
alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists age_band text;
alter table public.profiles add column if not exists guardian_email text;
alter table public.profiles add column if not exists guardian_consent_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_age_band_check') then
    alter table public.profiles
      add constraint profiles_age_band_check check (age_band is null or age_band in ('13-17', '18+'));
  end if;
end $$;

-- Existing profiles keep terms_version null, which is what shows the one-time acceptance screen.
-- Users update their own row through the existing own-row profile policy.
