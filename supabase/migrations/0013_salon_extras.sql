-- 0013_salon_extras: fields the redesigned salon screen surfaces.
-- (Grants already cover these: 0011 granted all salons columns, 0002 granted all services columns.)

alter table public.salons add column website text;

-- service grouping for the "Hair Services · N types" rows; existing rows default in
alter table public.services add column category text not null default 'Hair Services';
