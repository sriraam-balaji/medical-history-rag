create or replace function public.delete_patient_document(target_document uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_patient uuid;
begin
  select patient_id into target_patient from public.documents where id = target_document;
  if target_patient is null then
    return false;
  end if;
  if not (public.has_patient_access(target_patient) or public.is_admin()) then
    raise exception 'Not authorized to delete this document';
  end if;
  delete from public.medical_events where source_document_id = target_document;
  delete from public.medications where source_document_id = target_document;
  delete from public.vitals where source_document_id = target_document;
  delete from public.lab_results where source_document_id = target_document;
  delete from public.documents where id = target_document;
  return true;
end;
$$;

revoke all on function public.delete_patient_document(uuid) from public;
grant execute on function public.delete_patient_document(uuid) to authenticated;
