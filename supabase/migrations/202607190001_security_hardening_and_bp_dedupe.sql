-- Security hardening from Supabase advisor findings + blood-pressure data cleanup.

-- 1. Pin search_path on match_document_chunks (advisor: function_search_path_mutable).
alter function public.match_document_chunks(vector, uuid, integer) set search_path = public;

-- 2. Remove PUBLIC / anon execute on internal and SECURITY DEFINER functions.
revoke execute on function public.match_document_chunks(vector, uuid, integer) from public, anon;
revoke execute on function public.has_patient_access(uuid) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.rls_auto_enable() from public, anon;
revoke execute on function public.delete_patient_document(uuid) from public, anon;
revoke execute on function public.create_patient_profile(text) from public, anon;
revoke execute on function public.create_patient_profile(text, date, text) from public, anon;

-- Keep the roles that legitimately need them.
grant execute on function public.match_document_chunks(vector, uuid, integer) to authenticated, service_role;
grant execute on function public.delete_patient_document(uuid) to authenticated;

-- 3. Data cleanup: the extractor used to insert a generic 'blood_pressure' row that
-- duplicates the 'Systolic Blood Pressure' row for the same reading. Remove the duplicates.
delete from public.vitals bp
using public.vitals sys
where bp.vital_type = 'blood_pressure'
  and sys.vital_type = 'Systolic Blood Pressure'
  and bp.patient_id = sys.patient_id
  and bp.value = sys.value
  and coalesce(bp.source_document_id, '00000000-0000-0000-0000-000000000000') = coalesce(sys.source_document_id, '00000000-0000-0000-0000-000000000000')
  and coalesce(bp.measured_at, 'epoch'::timestamptz) = coalesce(sys.measured_at, 'epoch'::timestamptz);
