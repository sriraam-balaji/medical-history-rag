alter table public.patient_profiles add column if not exists date_of_birth date;
alter table public.patient_profiles add column if not exists biological_sex text;

create or replace function public.create_patient_profile(profile_name text, profile_dob date default null, profile_sex text default null)
returns public.patient_profiles
language plpgsql
security definer
set search_path = public
as $$
declare created_profile public.patient_profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if profile_name is null or length(trim(profile_name)) = 0 then raise exception 'Patient name is required'; end if;
  insert into public.patient_profiles (display_name, owner_user_id, date_of_birth, biological_sex)
  values (trim(profile_name), auth.uid(), profile_dob, nullif(trim(profile_sex), ''))
  returning * into created_profile;
  return created_profile;
end;
$$;

revoke execute on function public.create_patient_profile(text, date, text) from public, anon;
grant execute on function public.create_patient_profile(text, date, text) to authenticated;
