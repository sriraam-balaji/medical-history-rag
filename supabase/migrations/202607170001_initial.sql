create extension if not exists vector with schema extensions;

create type public.app_role as enum ('admin', 'patient_owner', 'patient_editor', 'patient_viewer');
create type public.processing_status as enum ('queued', 'batch_submitted', 'processing', 'validated', 'indexed', 'failed_retryable', 'failed_permanent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.patient_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.patient_access (
  patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'patient_viewer',
  created_at timestamptz not null default now(),
  primary key (patient_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  claimed_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  original_filename text not null,
  storage_path text not null unique,
  document_type text,
  processing_status public.processing_status not null default 'queued',
  batch_job_id text,
  file_hash text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  status public.processing_status not null default 'queued',
  attempt_count int not null default 0,
  gemini_batch_id text,
  raw_output jsonb,
  validated_output jsonb,
  model_version text,
  prompt_version text,
  schema_version text,
  validation_warnings jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medical_events (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  event_date date, event_type text not null, title text not null, summary text, source_document_id uuid references public.documents(id) on delete set null,
  source_page int, evidence text, confidence numeric check (confidence between 0 and 1), created_at timestamptz not null default now()
);

create table public.medications (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  brand_name text, generic_name text, strength text, dosage_form text, route text, manufacturer text,
  composition_status text not null default 'unknown', source_document_id uuid references public.documents(id) on delete set null,
  source_page int, confidence numeric check (confidence between 0 and 1), created_at timestamptz not null default now()
);

create table public.medication_history (
  id uuid primary key default gen_random_uuid(), medication_id uuid not null references public.medications(id) on delete cascade,
  status text not null check (status in ('prescribed','reported_taking','stopped','changed','completed','unknown')),
  dose text, frequency text, start_date date, end_date date, reason text, source_document_id uuid references public.documents(id) on delete set null,
  source_page int, evidence text, confidence numeric check (confidence between 0 and 1), created_at timestamptz not null default now()
);

create table public.vitals (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  vital_type text not null, value numeric not null, unit text, measured_at timestamptz, context text,
  source_document_id uuid references public.documents(id) on delete set null, source_page int, evidence text, confidence numeric check (confidence between 0 and 1), created_at timestamptz not null default now()
);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  test_name_raw text not null, test_name_normalized text, value_text text, numeric_value numeric, unit text, reference_range text,
  measured_at timestamptz, source_document_id uuid references public.documents(id) on delete set null, source_page int, evidence text, confidence numeric check (confidence between 0 and 1), created_at timestamptz not null default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patient_profiles(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade, chunk_index int not null, content text not null,
  page_start int, page_end int, embedding vector(768), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(document_id, chunk_index)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid references auth.users(id) on delete set null,
  action text not null, patient_id uuid references public.patient_profiles(id) on delete set null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index document_chunks_embedding_idx on public.document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 50);
create index documents_patient_idx on public.documents(patient_id, created_at desc);
create index vitals_patient_idx on public.vitals(patient_id, measured_at desc);
create index lab_results_patient_idx on public.lab_results(patient_id, measured_at desc);

create or replace function public.has_patient_access(target_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.patient_access where patient_id = target_patient and user_id = auth.uid())
    or exists(select 1 from public.patient_profiles where id = target_patient and owner_user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.patient_access where user_id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.patient_profiles enable row level security;
alter table public.patient_access enable row level security;
alter table public.invitations enable row level security;
alter table public.documents enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.medical_events enable row level security;
alter table public.medications enable row level security;
alter table public.medication_history enable row level security;
alter table public.vitals enable row level security;
alter table public.lab_results enable row level security;
alter table public.document_chunks enable row level security;
alter table public.audit_logs enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "patient access" on public.patient_profiles for select using (public.has_patient_access(id));
create policy "patient owners create" on public.patient_profiles for insert with check (owner_user_id = auth.uid());
create policy "patient owners update" on public.patient_profiles for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "patient access rows" on public.patient_access for select using (user_id = auth.uid() or public.is_admin());

do $$ declare t text; begin
  foreach t in array array['documents','medical_events','medications','vitals','lab_results','document_chunks'] loop
    execute format('create policy "patient records select" on public.%I for select using (public.has_patient_access(patient_id));', t);
  end loop;
end $$;

create policy "patient documents insert" on public.documents for insert with check (public.has_patient_access(patient_id));
create policy "patient records update" on public.documents for update using (public.has_patient_access(patient_id));
create policy "patient records delete" on public.documents for delete using (public.is_admin() or public.has_patient_access(patient_id));
create policy "patient records insert facts" on public.medical_events for insert with check (public.has_patient_access(patient_id));
create policy "patient records insert meds" on public.medications for insert with check (public.has_patient_access(patient_id));
create policy "patient records insert vitals" on public.vitals for insert with check (public.has_patient_access(patient_id));
create policy "patient records insert labs" on public.lab_results for insert with check (public.has_patient_access(patient_id));
create policy "patient records insert chunks" on public.document_chunks for insert with check (public.has_patient_access(patient_id));

create or replace function public.match_document_chunks(query_embedding vector(768), match_patient_id uuid, match_count int default 8)
returns table (id uuid, document_id uuid, content text, page_start int, page_end int, similarity float)
language sql stable as $$
  select c.id, c.document_id, c.content, c.page_start, c.page_end, 1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.patient_id = match_patient_id and public.has_patient_access(c.patient_id) and c.embedding is not null
  order by c.embedding <=> query_embedding limit match_count;
$$;

insert into storage.buckets (id, name, public) values ('medical-documents', 'medical-documents', false) on conflict (id) do nothing;

create policy "medical files are readable by patient members" on storage.objects
for select to authenticated using (
  bucket_id = 'medical-documents' and public.has_patient_access((storage.foldername(name))[1]::uuid)
);

create policy "medical files are uploadable by patient members" on storage.objects
for insert to authenticated with check (
  bucket_id = 'medical-documents' and public.has_patient_access((storage.foldername(name))[1]::uuid)
);

create policy "medical files are removable by admins or patient members" on storage.objects
for delete to authenticated using (
  bucket_id = 'medical-documents' and (public.is_admin() or public.has_patient_access((storage.foldername(name))[1]::uuid))
);
