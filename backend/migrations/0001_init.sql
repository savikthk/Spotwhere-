create extension if not exists postgis;

drop table if exists venues;

create table venues (
  id bigint primary key,
  name text not null,
  description text not null default '',
  address text not null default '',
  tags text[] not null default '{}',
  avg_bill integer not null,
  maps_url text not null,
  location geography(Point, 4326) not null
);

create index venues_location on venues using gist (location);
create index venues_tags on venues using gin (tags);

create table places (
  id integer primary key,
  kind text not null check (kind in ('metro', 'district')),
  name text not null,
  location geography(Point, 4326) not null,
  area geography(MultiPolygon, 4326)
);

create index places_area on places using gist (area);

create table geocode_cache (
  query_key text primary key,
  label text,
  location geography(Point, 4326),
  created_at timestamptz not null
);

create table if not exists user_tag_weights (
  user_id bigint not null,
  tag text not null,
  weight double precision not null
);

create unique index if not exists user_tag_weights_user_tag on user_tag_weights (user_id, tag);
