alter table public.documents
  add column if not exists content_classification text not null default 'pending',
  add column if not exists rejection_reason text;

alter table public.medical_events
  add column if not exists doctor_name text,
  add column if not exists specialty text,
  add column if not exists facility text,
  add column if not exists visit_reason text;

create index if not exists medical_events_patient_date_idx
  on public.medical_events(patient_id, event_date desc);
