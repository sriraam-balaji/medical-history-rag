-- The Medicines UI offers edit and delete, but medications only had insert/select
-- policies — updates and deletes silently affected 0 rows under RLS.
create policy "medications update" on public.medications
  for update using (public.has_patient_access(patient_id)) with check (public.has_patient_access(patient_id));
create policy "medications delete" on public.medications
  for delete using (public.has_patient_access(patient_id));
