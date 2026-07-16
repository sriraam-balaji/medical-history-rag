drop policy if exists "patient documents insert" on public.documents;
create policy "patient documents insert" on public.documents for insert to authenticated
with check (public.has_patient_access(patient_id) and created_by = auth.uid());

drop policy if exists "patient records update" on public.documents;
create policy "patient records update" on public.documents for update to authenticated
using (public.has_patient_access(patient_id))
with check (public.has_patient_access(patient_id));
