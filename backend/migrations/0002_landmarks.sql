alter table places drop constraint places_kind_check;
alter table places add constraint places_kind_check check (kind in ('metro', 'district', 'landmark'));
alter table places add column aliases text[] not null default '{}';
