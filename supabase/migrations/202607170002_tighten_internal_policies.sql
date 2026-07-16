create policy "own extraction jobs" on public.extraction_jobs for select using (exists (select 1 from public.documents d where d.id = extraction_jobs.document_id and public.has_patient_access(d.patient_id)));
create policy "own medication history" on public.medication_history for select using (exists (select 1 from public.medications m where m.id = medication_history.medication_id and public.has_patient_access(m.patient_id)));
create policy "own audit logs" on public.audit_logs for select using (actor_user_id = auth.uid() or public.is_admin());
create policy "admin invitations" on public.invitations for all using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
revoke execute on function public.has_patient_access(uuid) from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
