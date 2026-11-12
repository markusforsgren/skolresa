-- =====================================================================
-- Klassmålet – databasschema för Supabase
-- Kör hela filen i Supabase → SQL Editor → New query → Run.
-- Skriptet går att köra flera gånger (idempotent).
-- Alla tabeller har prefix km_ så de inte krockar med gamla "votes" m.fl.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Hjälpfunktion: generera unik klasskod (6 tecken, inga O/0/I/1)
-- ---------------------------------------------------------------------
create or replace function public.km_gen_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.km_classes where code = c);
  end loop;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------
create table if not exists public.km_classes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code            text unique,
  name            text not null check (char_length(name) between 1 and 80),      -- t.ex. "Klass 5B"
  school          text check (char_length(school) <= 120),
  trip_title      text check (char_length(trip_title) <= 120),                   -- t.ex. "Klassresan våren 2027"
  student_count   int  not null default 25 check (student_count between 1 and 200),
  adult_count     int  not null default 0  check (adult_count between 0 and 100),
  voting_open     boolean not null default true,
  allow_custom    boolean not null default true,   -- elever får skriva egna förslag
  show_results    boolean not null default false,  -- elever ser resultatet
  show_costs      boolean not null default true,   -- elever ser kostnadsfliken
  show_fundraising boolean not null default true,  -- elever ser insamlingsfliken
  saved_amount    numeric not null default 0 check (saved_amount >= 0), -- klasskassa utöver försäljning
  settings        jsonb not null default '{}'::jsonb,  -- fasta kostnader, transport, mål
  -- Förberett för betalning (39 kr/klass). Används inte ännu.
  paid            boolean not null default false,
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.km_destinations (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references public.km_classes(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 100),
  location        text check (char_length(location) <= 100),
  subtitle        text check (char_length(subtitle) <= 140),
  description     text check (char_length(description) <= 3000),
  image_url       text check (char_length(image_url) <= 1000),
  video_url       text check (char_length(video_url) <= 500),
  website_url     text check (char_length(website_url) <= 500),
  tags            text[] not null default '{}',
  overnight       boolean not null default true,
  sort_order      int not null default 0,
  -- Kostnader (per deltagare om inte annat anges)
  cost_entrance       numeric not null default 0 check (cost_entrance >= 0),
  cost_extra          numeric not null default 0 check (cost_extra >= 0),
  cost_accommodation  numeric not null default 0 check (cost_accommodation >= 0),
  cost_transport      numeric check (cost_transport >= 0),     -- totalt för gruppen; null = klassens standard
  includes_food       boolean not null default false,          -- paket där mat ingår → matkostnader räknas bort
  created_at      timestamptz not null default now()
);
create index if not exists km_destinations_class_idx on public.km_destinations(class_id);
-- Antal dagsturer i samma alternativ (t.ex. Gröna Lund en dag + Leksand en dag)
alter table public.km_destinations add column if not exists days int not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'km_destinations_days_chk') then
    alter table public.km_destinations add constraint km_destinations_days_chk check (days between 1 and 10);
  end if;
end $$;

create table if not exists public.km_votes (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references public.km_classes(id) on delete cascade,
  voter_name      text not null check (char_length(voter_name) between 1 and 40),
  destination_id  uuid references public.km_destinations(id) on delete set null,
  custom_text     text check (char_length(custom_text) <= 60),
  created_at      timestamptz not null default now(),
  check (destination_id is not null or custom_text is not null)
);
create unique index if not exists km_votes_unique_name on public.km_votes(class_id, lower(btrim(voter_name)));

create table if not exists public.km_sales (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references public.km_classes(id) on delete cascade,
  label           text not null check (char_length(label) between 1 and 60),
  emoji           text check (char_length(emoji) <= 8),
  unit_price      numeric not null default 0 check (unit_price >= 0),  -- förtjänst per såld enhet
  quantity        numeric not null default 0 check (quantity >= 0),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists km_sales_class_idx on public.km_sales(class_id);

-- ---------------------------------------------------------------------
-- Triggers: klasskod + updated_at
-- ---------------------------------------------------------------------
create or replace function public.km_classes_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.code := public.km_gen_code();
    new.paid := false;           -- kan bara sättas av servern (service role) senare
    new.paid_at := null;
  else
    if coalesce(current_setting('km.allow_code_change', true), '') <> '1' then
      new.code := old.code;      -- koden kan inte ändras från klienten
    end if;
    new.owner_id := old.owner_id;
    if current_user in ('authenticated', 'anon') then
      new.paid := old.paid;
      new.paid_at := old.paid_at;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists km_classes_before_trg on public.km_classes;
create trigger km_classes_before_trg before insert or update on public.km_classes
  for each row execute function public.km_classes_before();

-- Ny kod på begäran (om koden läckt)
create or replace function public.km_regenerate_code(p_class_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not exists (select 1 from km_classes where id = p_class_id and owner_id = auth.uid()) then
    raise exception 'not_owner';
  end if;
  c := km_gen_code();
  perform set_config('km.allow_code_change', '1', true);
  update km_classes set code = c where id = p_class_id;
  perform set_config('km.allow_code_change', '', true);
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: varje vuxen ser bara sina egna klasser.
-- Elever (anon) har INGEN direkt tabellåtkomst – bara via funktionerna nedan.
-- ---------------------------------------------------------------------
alter table public.km_classes      enable row level security;
alter table public.km_destinations enable row level security;
alter table public.km_votes        enable row level security;
alter table public.km_sales        enable row level security;

drop policy if exists km_classes_owner on public.km_classes;
create policy km_classes_owner on public.km_classes
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists km_destinations_owner on public.km_destinations;
create policy km_destinations_owner on public.km_destinations
  for all to authenticated
  using (exists (select 1 from public.km_classes c where c.id = class_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.km_classes c where c.id = class_id and c.owner_id = auth.uid()));

drop policy if exists km_votes_owner on public.km_votes;
create policy km_votes_owner on public.km_votes
  for all to authenticated
  using (exists (select 1 from public.km_classes c where c.id = class_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.km_classes c where c.id = class_id and c.owner_id = auth.uid()));

drop policy if exists km_sales_owner on public.km_sales;
create policy km_sales_owner on public.km_sales
  for all to authenticated
  using (exists (select 1 from public.km_classes c where c.id = class_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.km_classes c where c.id = class_id and c.owner_id = auth.uid()));

revoke all on public.km_classes, public.km_destinations, public.km_votes, public.km_sales from anon;
grant select, insert, update, delete on public.km_classes, public.km_destinations, public.km_votes, public.km_sales to authenticated;

-- ---------------------------------------------------------------------
-- Publik funktion: hämta klass via kod (för elevsidan)
-- ---------------------------------------------------------------------
create or replace function public.km_get_class(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c km_classes;
  result jsonb;
begin
  select * into c from km_classes where code = upper(btrim(p_code));
  if not found then
    return null;
  end if;

  result := jsonb_build_object(
    'class', jsonb_build_object(
      'name', c.name, 'school', c.school, 'trip_title', c.trip_title,
      'student_count', c.student_count, 'adult_count', c.adult_count,
      'voting_open', c.voting_open, 'allow_custom', c.allow_custom,
      'show_results', c.show_results, 'show_costs', c.show_costs,
      'show_fundraising', c.show_fundraising
    ),
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'location', d.location, 'subtitle', d.subtitle,
        'description', d.description, 'image_url', d.image_url, 'video_url', d.video_url,
        'website_url', d.website_url, 'tags', d.tags, 'overnight', d.overnight, 'days', d.days
      ) || case when c.show_costs then jsonb_build_object(
        'cost_entrance', d.cost_entrance, 'cost_extra', d.cost_extra,
        'cost_accommodation', d.cost_accommodation, 'cost_transport', d.cost_transport,
        'includes_food', d.includes_food
      ) else '{}'::jsonb end
      order by d.sort_order, d.created_at)
      from km_destinations d where d.class_id = c.id), '[]'::jsonb),
    'vote_count', (select count(*) from km_votes v where v.class_id = c.id)
  );

  if c.show_results then
    result := result || jsonb_build_object('results', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc)
      from (
        select coalesce(d.name, v.custom_text) as label, count(*) as n
        from km_votes v left join km_destinations d on d.id = v.destination_id
        where v.class_id = c.id
        group by 1
      ) r), '[]'::jsonb));
  end if;

  if c.show_costs or c.show_fundraising then
    result := result || jsonb_build_object(
      'settings', c.settings,
      'saved_amount', c.saved_amount,
      'sales_total', (select coalesce(sum(unit_price * quantity), 0) from km_sales s where s.class_id = c.id)
    );
  end if;

  if c.show_fundraising then
    result := result || jsonb_build_object('sales', coalesce((
      select jsonb_agg(jsonb_build_object('label', s.label, 'emoji', s.emoji,
             'unit_price', s.unit_price, 'quantity', s.quantity) order by s.sort_order, s.created_at)
      from km_sales s where s.class_id = c.id and s.quantity > 0), '[]'::jsonb));
  end if;

  return result;
end $$;

-- ---------------------------------------------------------------------
-- Publik funktion: lägg en röst
-- Returnerar 'ok' eller en felkod: not_found, closed, name_taken,
-- invalid_name, invalid_choice, custom_not_allowed, full
-- ---------------------------------------------------------------------
create or replace function public.km_cast_vote(
  p_code text, p_name text, p_destination_id uuid default null, p_custom text default null
) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  c km_classes;
  v_name text := btrim(coalesce(p_name, ''));
  v_custom text := nullif(btrim(coalesce(p_custom, '')), '');
  n int;
begin
  select * into c from km_classes where code = upper(btrim(p_code));
  if not found then return 'not_found'; end if;
  if not c.voting_open then return 'closed'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then return 'invalid_name'; end if;

  if p_destination_id is not null then
    if not exists (select 1 from km_destinations where id = p_destination_id and class_id = c.id) then
      return 'invalid_choice';
    end if;
    v_custom := null;
  else
    if v_custom is null then return 'invalid_choice'; end if;
    if not c.allow_custom then return 'custom_not_allowed'; end if;
    if char_length(v_custom) > 60 then return 'invalid_choice'; end if;
  end if;

  -- Skydd mot spam: max dubbla klasstorleken + vuxna + 10 röster
  select count(*) into n from km_votes where class_id = c.id;
  if n >= (c.student_count + c.adult_count) * 2 + 10 then return 'full'; end if;

  begin
    insert into km_votes(class_id, voter_name, destination_id, custom_text)
    values (c.id, v_name, p_destination_id, v_custom);
  exception when unique_violation then
    return 'name_taken';
  end;
  return 'ok';
end $$;

revoke all on function public.km_get_class(text) from public;
revoke all on function public.km_cast_vote(text, text, uuid, text) from public;
revoke all on function public.km_regenerate_code(uuid) from public;
revoke all on function public.km_gen_code() from public;
grant execute on function public.km_get_class(text) to anon, authenticated;
grant execute on function public.km_cast_vote(text, text, uuid, text) to anon, authenticated;
grant execute on function public.km_regenerate_code(uuid) to authenticated;
grant execute on function public.km_gen_code() to authenticated;

-- ---------------------------------------------------------------------
-- Bildlagring: publik bucket, varje vuxen skriver bara i sin egen mapp
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('km-images', 'km-images', true)
on conflict (id) do update set public = true;

drop policy if exists km_images_insert on storage.objects;
create policy km_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'km-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists km_images_update on storage.objects;
create policy km_images_update on storage.objects for update to authenticated
  using (bucket_id = 'km-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists km_images_delete on storage.objects;
create policy km_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'km-images' and (storage.foldername(name))[1] = auth.uid()::text);
