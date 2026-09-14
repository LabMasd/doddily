-- Little Days: core schema
create extension if not exists postgis;

-- Classes, groups, screenings and outings (from research + submissions)
create table public.activities (
  id              text primary key,
  name            text not null,
  provider        text,
  category        text not null check (category in ('library','stayplay','support','music','sensory','movement','massage','fitness','swim','cinema','museum','farm','softplay','cafe','outdoor')),
  venue           text,
  address         text,
  postcode        text,
  location        geography(point, 4326) not null,
  sessions        jsonb not null default '[]',      -- [{day:'Mon', start:'10:00', end:'11:00'}]
  days            text[] generated always as (array(select distinct s->>'day' from jsonb_array_elements(sessions) s)) stored,
  tier            text not null default 'venue' check (tier in ('timetable','venue','place')),
  schedule_note   text,
  age_min_months  int default 0,
  age_max_months  int,
  price           text,
  free            boolean not null default false,
  booking         text check (booking in ('drop-in','book','term')),
  indoor          boolean not null default true,
  description     text,
  url             text,
  phone           text,
  source          text,
  confidence      text check (confidence in ('high','medium','low')),
  checked_at      date not null default current_date,
  hidden          boolean not null default false,   -- takedowns / ended classes
  updated_at      timestamptz not null default now()
);
create index activities_location_idx on public.activities using gist (location);
create index activities_days_idx on public.activities using gin (days);
create index activities_category_idx on public.activities (category);

-- Parks, playgrounds, libraries, pools, soft play, baby change (from OpenStreetMap)
create table public.places (
  id          text primary key,                     -- 'osm:node/123'
  name        text not null,
  kind        text not null check (kind in ('playground','park','library','pool','softplay','farm','museum','change')),
  location    geography(point, 4326) not null,
  context     text,                                 -- e.g. 'Playground in Clissold Park'
  opening_hours text,
  url         text,
  indoor      boolean not null default false,
  tags        jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
create index places_location_idx on public.places using gist (location);

-- "Something wrong?" reports from the app
create table public.reports (
  id          bigint generated always as identity primary key,
  activity_id text references public.activities(id) on delete cascade,
  kind        text not null check (kind in ('wrong_time','closed','wrong_price','wrong_place','other')),
  note        text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Saved items, synced for signed-in users (optional feature)
create table public.saved (
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity_id text not null,                        -- activities.id or places.id
  created_at  timestamptz not null default now(),
  primary key (user_id, activity_id)
);

-- Nearby query used by the app: everything within radius, optional weekday filter.
create or replace function public.activities_near(lat double precision, lng double precision, radius_m double precision, weekday text default null)
returns table (
  id text, name text, provider text, category text, venue text, address text, postcode text,
  lat double precision, lng double precision, distance_m double precision,
  sessions jsonb, tier text, schedule_note text, age_min_months int, age_max_months int,
  price text, free boolean, booking text, indoor boolean, description text, url text, phone text,
  confidence text, checked_at date
)
language sql stable as $$
  select a.id, a.name, a.provider, a.category, a.venue, a.address, a.postcode,
         st_y(a.location::geometry), st_x(a.location::geometry),
         st_distance(a.location, st_makepoint(lng, lat)::geography),
         a.sessions, a.tier, a.schedule_note, a.age_min_months, a.age_max_months,
         a.price, a.free, a.booking, a.indoor, a.description, a.url, a.phone,
         a.confidence, a.checked_at
  from public.activities a
  where not a.hidden
    and st_dwithin(a.location, st_makepoint(lng, lat)::geography, least(radius_m, 32187))  -- cap 20 miles
    and (weekday is null or weekday = any(a.days) or a.tier <> 'timetable')
  order by 13
  limit 1500;
$$;

create or replace function public.places_near(lat double precision, lng double precision, radius_m double precision)
returns table (id text, name text, kind text, lat double precision, lng double precision, distance_m double precision, context text, opening_hours text, url text, indoor boolean)
language sql stable as $$
  select p.id, p.name, p.kind, st_y(p.location::geometry), st_x(p.location::geometry),
         st_distance(p.location, st_makepoint(lng, lat)::geography), p.context, p.opening_hours, p.url, p.indoor
  from public.places p
  where st_dwithin(p.location, st_makepoint(lng, lat)::geography, least(radius_m, 16093))  -- cap 10 miles
  order by 6
  limit 800;
$$;

-- Row level security: listings are public to read; writes only via service role (import scripts).
alter table public.activities enable row level security;
alter table public.places     enable row level security;
alter table public.reports    enable row level security;
alter table public.saved      enable row level security;

create policy "read activities" on public.activities for select using (not hidden);
create policy "read places"     on public.places     for select using (true);
create policy "anyone can report" on public.reports  for insert with check (char_length(coalesce(note,'')) <= 500);
create policy "own saved read"   on public.saved for select using (auth.uid() = user_id);
create policy "own saved write"  on public.saved for insert with check (auth.uid() = user_id);
create policy "own saved delete" on public.saved for delete using (auth.uid() = user_id);

grant execute on function public.activities_near to anon, authenticated;
grant execute on function public.places_near to anon, authenticated;
