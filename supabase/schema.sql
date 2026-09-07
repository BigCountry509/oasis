-- Spray record storage for the nozzle calculator.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It creates
-- the table the site writes to and locks it down so each account can only ever
-- see its own records.
--
-- Nothing else needs configuring on the Supabase side except turning on the
-- email and password sign in provider, which is on by default.

create table if not exists public.spray_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- what the operator calls this application
  name text not null,
  applied_on date,

  -- where
  field_name text,
  acres numeric,
  crop text,

  -- what kind of pass it was
  application_id text,
  application_name text,
  sprayer_type text,

  -- how it was set up
  gpa numeric,
  mph numeric,
  psi numeric,
  spacing_inches numeric,
  row_spacing_feet numeric,
  nozzles jsonb default '[]'::jsonb,
  droplet_class text,

  -- what went in the tank: [{ name, epaRegNo, rate, unit }]
  products jsonb default '[]'::jsonb,

  -- conditions at the time of application
  wind_mph numeric,
  wind_direction text,
  air_temp_f numeric,
  humidity numeric,

  -- who applied it
  applicator text,
  license_no text,

  notes text,

  -- the full calculator output, kept so an old record can be reproduced even
  -- after the tip catalog or scoring changes
  calc jsonb,

  created_at timestamptz not null default now()
);

create index if not exists spray_records_user_date_idx
  on public.spray_records (user_id, applied_on desc);

alter table public.spray_records enable row level security;

-- One policy per action so the intent is explicit: a signed in user can read and
-- change their own rows and nobody else's.
drop policy if exists spray_records_select_own on public.spray_records;
create policy spray_records_select_own
  on public.spray_records for select
  using (auth.uid() = user_id);

drop policy if exists spray_records_insert_own on public.spray_records;
create policy spray_records_insert_own
  on public.spray_records for insert
  with check (auth.uid() = user_id);

drop policy if exists spray_records_update_own on public.spray_records;
create policy spray_records_update_own
  on public.spray_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists spray_records_delete_own on public.spray_records;
create policy spray_records_delete_own
  on public.spray_records for delete
  using (auth.uid() = user_id);
