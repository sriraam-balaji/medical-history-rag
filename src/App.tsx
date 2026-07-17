import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Clock3, FileText, HeartPulse, LoaderCircle, LogIn, Menu, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'
import type { DocumentRecord, LabResult, MedicalEvent, Medication, PatientProfile, Vital } from './types'

const tabs = ['Overview', 'Documents', 'Medicines', 'Doctors & visits', 'Vitals & labs', 'Ask the archive']
const demoPatients: PatientProfile[] = [{ id: 'demo', display_name: 'Create your first patient profile' }]

function App() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [patients, setPatients] = useState<PatientProfile[]>([])
  const [selectedPatient, setSelectedPatient] = useState('')
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [vitals, setVitals] = useState<Vital[]>([])
  const [labs, setLabs] = useState<LabResult[]>([])
  const [medicines, setMedicines] = useState<Medication[]>([])
  const [events, setEvents] = useState<MedicalEvent[]>([])
  const [activeTab, setActiveTab] = useState(() => tabFromHash())
  const [showLogin, setShowLogin] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [patientName, setPatientName] = useState('')
  const [patientDob, setPatientDob] = useState('')
  const [patientSex, setPatientSex] = useState('')
  const [creatingPatient, setCreatingPatient] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({})
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState<Array<{ document_id: string; page_start: number | null; page_end: number | null }>>([])
  const [asking, setAsking] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  function tabFromHash() {
    const hash = window.location.hash.replace('#', '')
    return tabs.find((tab) => tab.toLowerCase().replaceAll(' ', '-').replace('&-', '') === hash) ?? 'Overview'
  }

  function navigate(tab: string) {
    setActiveTab(tab)
    setMobileSidebarOpen(false)
    window.history.replaceState(null, '', `#${tab.toLowerCase().replaceAll(' ', '-').replace('&-', '')}`)
  }

  useEffect(() => { document.documentElement.classList.toggle('mobile-sidebar-open', mobileSidebarOpen); return () => document.documentElement.classList.remove('mobile-sidebar-open') }, [mobileSidebarOpen])

  useEffect(() => {
    const onHash = () => setActiveTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    if (!supabase) return () => window.removeEventListener('hashchange', onHash)
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null))
    const { data } = supabase.auth.onAuthStateChange((event, current) => { setSessionEmail(current?.user.email ?? null); if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true) })
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash) }
  }, [])

  useEffect(() => { if (supabase && sessionEmail) loadPatients() }, [sessionEmail])
  useEffect(() => {
    if (!supabase || !selectedPatient) return
    refreshPatientData(selectedPatient)
    const timer = window.setInterval(() => refreshPatientData(selectedPatient), 5000)
    return () => window.clearInterval(timer)
  }, [selectedPatient])

  async function refreshPatientData(patientId: string) {
    if (!supabase) return
    const [docs, vitalRows, labRows, medRows, eventRows] = await Promise.all([
      supabase.from('documents').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('vitals').select('*').eq('patient_id', patientId).order('measured_at', { ascending: false }).limit(50),
      supabase.from('lab_results').select('*').eq('patient_id', patientId).order('measured_at', { ascending: false }).limit(100),
      supabase.from('medications').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('medical_events').select('*').eq('patient_id', patientId).order('event_date', { ascending: false }).limit(50),
    ])
    if (docs.error) {
      setNotice(`Could not refresh the document library: ${docs.error.message}. Retrying automatically…`)
    } else setDocuments((docs.data ?? []) as DocumentRecord[])
    if (!vitalRows.error) setVitals((vitalRows.data ?? []) as Vital[])
    if (!labRows.error) setLabs((labRows.data ?? []) as LabResult[])
    if (!medRows.error) setMedicines((medRows.data ?? []) as Medication[])
    if (!eventRows.error) setEvents((eventRows.data ?? []) as MedicalEvent[])
    if (!docs.error && docs.data?.length) {
      const jobs = await supabase.from('extraction_jobs').select('document_id, error_message, created_at').in('document_id', docs.data.map((doc) => doc.id)).order('created_at', { ascending: false })
      if (!jobs.error) {
        const errors: Record<string, string> = {}
        for (const job of jobs.data ?? []) if (job.error_message && !errors[job.document_id]) errors[job.document_id] = job.error_message
        for (const doc of docs.data ?? []) if (doc.processing_status === 'indexed' && (doc.retry_count ?? 0) < 1 && !errors[doc.id]) errors[doc.id] = 'One extraction retry is available for improved classification and care-instruction extraction.'
        setDocumentErrors(errors)
      }
    }
  }

  async function loadPatients() {
    if (!supabase) return
    const { data, error } = await supabase.from('patient_profiles').select('id, display_name, created_at, date_of_birth, biological_sex').order('created_at')
    if (error) setNotice(error.message)
    else { setPatients((data ?? []) as PatientProfile[]); if (data?.[0]) setSelectedPatient(data[0].id); else setShowProfileForm(true) }
  }

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault(); if (!supabase || authBusy) return
    setAuthBusy(true); setNotice('')
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setAuthBusy(false)
    if (result.error) {
      if (authMode === 'signup' && /already registered|already been registered|user already exists/i.test(result.error.message)) {
        const existingSignIn = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (!existingSignIn.error) { setNotice('This account already existed, and you are now signed in.'); setShowLogin(false); setPassword('') }
        else { setAuthMode('signin'); setNotice('This email is already registered, but that password is incorrect. Use Forgot password to set a new one.') }
      } else setNotice(result.error.message)
    }
    else if (authMode === 'signup' && !result.data.session) {
      const signIn = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signIn.error) setNotice('Account created, but Supabase still requires email confirmation. Disable Confirm email in Authentication → Providers → Email, then try again.')
      else { setNotice('Account created and signed in.'); setShowLogin(false); setPassword('') }
    }
    else { setNotice('Signed in.'); setShowLogin(false); setPassword('') }
  }

  async function resetPassword() {
    if (!supabase || !email.trim() || authBusy) { setNotice('Enter your email address first.'); return }
    setAuthBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    setAuthBusy(false)
    setNotice(error ? error.message : 'Check your email for a password reset link.')
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || authBusy) return
    if (newPassword.length < 6) { setNotice('Password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { setNotice('Passwords do not match.'); return }
    setAuthBusy(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setAuthBusy(false)
    if (error) setNotice(error.message)
    else { setRecoveryMode(false); setNewPassword(''); setConfirmPassword(''); setNotice('Password updated successfully.') }
  }

  async function createPatient(event?: React.FormEvent) {
    event?.preventDefault(); const name = patientName.trim()
    if (!name || !supabase || creatingPatient) return
    setCreatingPatient(true)
    const { data, error } = await supabase.rpc('create_patient_profile', { profile_name: name, profile_dob: patientDob || null, profile_sex: patientSex || null })
    setCreatingPatient(false)
    if (error) setNotice(error.message)
    else if (data) { setPatients((current) => [...current, data as PatientProfile]); setSelectedPatient(data.id); setPatientName(''); setPatientDob(''); setPatientSex(''); setShowProfileForm(false); setNotice('Patient profile created.') }
  }

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!supabase || !selectedPatient || !files.length || uploadingFiles) return
    const allowed = files.filter((file) => file.type === 'application/pdf' || file.type.startsWith('image/') || /\.(pdf|png|jpe?g|webp|heic)$/i.test(file.name))
    if (allowed.length !== files.length) { setNotice('Only PDF files and images (JPG, PNG, WEBP, or HEIC) can be uploaded.'); return }
    setUploadingFiles(true); setUploadProgress(0); setUploadTotal(files.length); setNotice(`Selected ${files.length} file${files.length === 1 ? '' : 's'}. Uploading…`)
    let done = 0
    let uploadedCount = 0
    const uploadErrors: string[] = []
    for (const file of files) {
      const id = crypto.randomUUID()
      const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const path = `${selectedPatient}/${id}/${safeName}`
      const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      let upload: { error: { message: string } | null } = { error: null }
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const buffer = await file.arrayBuffer()
          const blob = new Blob([buffer], { type: contentType })
          const result = await supabase.storage.from('medical-documents').upload(path, blob, {
            upsert: false,
            contentType,
            cacheControl: '3600',
          })
          upload = { error: result.error ? { message: result.error.message } : null }
        } catch (err: any) {
          upload = { error: { message: err?.message || 'Network fetch error' } }
        }
        if (!upload.error) break
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 900 * attempt))
      }
      if (upload.error) uploadErrors.push(`${file.name}: ${upload.error.message}`)
      else {
        const { data: userData } = await supabase.auth.getUser()
        const insert = await supabase.from('documents').insert({ id, patient_id: selectedPatient, original_filename: file.name, storage_path: path, processing_status: 'queued', created_by: userData.user?.id })
        if (insert.error) uploadErrors.push(`${file.name}: ${insert.error.message}`)
        else uploadedCount += 1
      }
      done += 1; setUploadProgress(done)
    }
    if (!uploadedCount) {
      setUploadingFiles(false)
      const err = uploadErrors[0] ?? ''
      if (/failed to fetch/i.test(err)) {
        setNotice('Upload failed ("Failed to fetch"). Check mobile network connection or verify Supabase Storage CORS settings allow your site domain.')
      } else {
        setNotice(err || 'The selected file could not be uploaded. Please try again.')
      }
      await refreshPatientData(selectedPatient)
      return
    }
    if (uploadErrors.length) setNotice(`${uploadedCount} file${uploadedCount === 1 ? '' : 's'} uploaded. ${uploadErrors[0]}`)
    const { data: processingResult, error } = await supabase.functions.invoke('enqueue-gemini-batch')
    setUploadingFiles(false)
    const failedResult = processingResult?.results?.find((result: { status: string; error?: string }) => result.error || result.status === 'failed_retryable')
    const transientFetchError = error && /failed to fetch|network|timeout|timed out/i.test(error.message)
    setNotice(error
      ? transientFetchError
        ? 'Files uploaded. Processing is running in the background; this page will update automatically when it completes.'
        : `Files uploaded, but processing could not start: ${error.message}`
      : failedResult?.error
        ? `Upload completed, but processing failed: ${failedResult.error}`
        : 'Files uploaded and processing has started. This can take a few minutes on the free tier.')
    await refreshPatientData(selectedPatient); event.target.value = ''
  }

  async function deleteDocument(document: DocumentRecord) {
    if (!supabase || deletingDocumentId) return
    if (!window.confirm(`Delete “${document.original_filename}” and its extracted data? This cannot be undone.`)) return
    setDeletingDocumentId(document.id)
    const removed = await supabase.storage.from('medical-documents').remove([document.storage_path])
    if (removed.error) { setNotice(`Could not delete the stored file: ${removed.error.message}`); setDeletingDocumentId(null); return }
    const { error } = await supabase.rpc('delete_patient_document', { target_document: document.id })
    setDeletingDocumentId(null)
    if (error) setNotice(`Could not delete the document record: ${error.message}`)
    else { setNotice('Document and extracted data deleted.'); await refreshPatientData(selectedPatient) }
  }

  async function retryDocument(document: DocumentRecord) {
    if (!supabase || deletingDocumentId) return
    if ((document.retry_count ?? 0) >= 1) { setNotice('This document has already used its one allowed retry.'); return }
    setDeletingDocumentId(document.id)
    const { error: updateError } = await supabase.from('documents').update({ processing_status: 'queued', processed_at: null, retry_count: (document.retry_count ?? 0) + 1 }).eq('id', document.id).eq('retry_count', document.retry_count ?? 0)
    const { data: processingResult, error: functionError } = updateError ? { data: null, error: updateError } : await supabase.functions.invoke('enqueue-gemini-batch')
    setDeletingDocumentId(null)
    const result = processingResult?.results?.find((item: { id: string }) => item.id === document.id)
    setNotice(updateError || functionError ? `Could not restart processing: ${(updateError ?? functionError)?.message}` : result?.error ? `Extraction completed, but indexing reported: ${result.error}` : result?.status === 'indexed' ? 'Processing complete. The document is now searchable.' : 'Processing restarted. Check the document status for the backend result.')
    await refreshPatientData(selectedPatient)
  }

  async function askArchive(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !selectedPatient || !question.trim() || asking) return
    setAsking(true); setAnswer(''); setCitations([])
    const { data, error } = await supabase.functions.invoke('ask-archive', { body: { patient_id: selectedPatient, question: question.trim() } })
    setAsking(false)
    if (error) setNotice(`Archive search failed: ${error.message}`)
    else if (data?.error) setNotice(`Archive search failed: ${data.error}`)
    else { setCitations(data?.citations ?? []); setAnswer(data?.answer ?? 'No answer returned.'); setNotice('Answer generated from indexed records.') }
  }

  async function openSource(documentId: string) {
    if (!supabase) return
    const document = documents.find((item) => item.id === documentId)
    if (!document) { setNotice('The original source is not available in this profile.'); return }
    const { data, error } = await supabase.storage.from('medical-documents').createSignedUrl(document.storage_path, 600)
    if (error || !data?.signedUrl) { setNotice(`Could not open source: ${error?.message ?? 'source unavailable'}`); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  function processingLabel(status: string) { return ({ queued: 'Queued', batch_submitted: 'Batch submitted', processing: 'Processing', validated: 'Extracted', indexed: 'Searchable', failed_retryable: 'Retrying', failed_permanent: 'Needs retry' } as Record<string, string>)[status] ?? status }
  function processingIcon(status: string) { if (status === 'indexed' || status === 'validated') return <CheckCircle2 size={13} />; if (status.includes('failed')) return <AlertCircle size={13} />; if (status === 'processing' || status === 'batch_submitted') return <LoaderCircle className="spin" size={13} />; return <Clock3 size={13} /> }
  const activePatient = useMemo(() => patients.find((p) => p.id === selectedPatient), [patients, selectedPatient])
  const displayPatients = supabaseConfigured ? patients : demoPatients

  if (!sessionEmail && supabaseConfigured) return <div className="auth-shell"><div className="auth-card"><div className="brand-mark"><HeartPulse size={22} /></div><p className="eyebrow">PRIVATE HEALTH ARCHIVE</p><h1>Keep the record together.</h1><p className="muted">A secure family workspace for documents, medicines, vitals, and timelines.</p>{!showLogin && <button className="primary full" onClick={() => setShowLogin(true)}><LogIn size={17} /> Sign in or create account</button>}<p className="tiny">Each account only sees its own patient profiles.</p>{showLogin && <form className="login-form" onSubmit={submitAuth}><div className="auth-mode"><button type="button" className={authMode === 'signin' ? 'selected' : ''} onClick={() => { setAuthMode('signin'); setNotice('') }}>Sign in</button><button type="button" className={authMode === 'signup' ? 'selected' : ''} onClick={() => { setAuthMode('signup'); setNotice('') }}>Create account</button></div><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" required minLength={6} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="primary full" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}</button><div className="auth-links"><button type="button" className="text-button" onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setNotice('') }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>{authMode === 'signin' && <button type="button" className="text-button" onClick={resetPassword} disabled={authBusy}>Forgot password?</button>}</div></form>}{notice && <p className="notice">{notice}</p>}</div></div>

  const documentList = <div className="document-list">{documents.map((doc) => <div className="document-row" key={doc.id}><div className="file-icon"><FileText size={17} /></div><div className="document-name"><strong>{doc.original_filename}</strong><span>{documentErrors[doc.id] ? 'Indexing needs retry' : doc.document_type ?? 'Awaiting classification'}</span></div><span className={`status ${doc.processing_status}`} title={documentErrors[doc.id]}>{processingIcon(doc.processing_status)} {documentErrors[doc.id] ? 'Needs retry' : processingLabel(doc.processing_status)}</span>{(doc.processing_status !== 'indexed' || documentErrors[doc.id]) && <button className="retry-button" onClick={() => retryDocument(doc)} disabled={deletingDocumentId === doc.id} aria-label="Retry processing" title="Retry processing"><RefreshCw size={14} /></button>}<button className="delete-button" onClick={() => deleteDocument(doc)} disabled={deletingDocumentId === doc.id} aria-label={`Delete ${doc.original_filename}`} title="Delete document">{deletingDocumentId === doc.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button></div>)}</div>
  const legacyPage = activeTab === 'Documents' ? <Page title="Document library" eyebrow="YOUR RECORDS"><div className="panel full-panel"><div className="panel-head"><div><p className="eyebrow">SOURCE FILES</p><h3>Every uploaded record</h3></div><span className="muted">{documents.length} file{documents.length === 1 ? '' : 's'}</span></div>{documents.length ? documentList : <Empty text="Upload a PDF or a clear photo of a medical page." />}</div></Page>
    : activeTab === 'Medicines' ? <Page title="Medicines" eyebrow="MEDICATION HISTORY"><div className="panel full-panel"><div className="panel-head"><div><p className="eyebrow">EXTRACTED MEDICINES</p><h3>Prescribed or mentioned</h3></div></div>{medicines.length ? medicines.map((med) => <div className="data-row" key={med.id}><strong>{med.brand_name || med.generic_name || 'Unnamed medicine'}</strong><span>{[med.generic_name, med.strength, med.dosage_form, med.route].filter(Boolean).join(' · ') || 'Details pending'}</span></div>) : <Empty text="Medicines will appear here when the extraction pipeline finds them." />}</div></Page>
    : activeTab === 'Doctors & visits' ? <VisitPage events={events} />
    : activeTab === 'Vitals & labs' ? <Page title="Vitals & labs" eyebrow="STRUCTURED HISTORY"><div className="content-grid"><div className="panel"><div className="panel-head"><div><p className="eyebrow">VITALS</p><h3>Measurements</h3></div><strong>{vitals.length}</strong></div>{vitals.length ? vitals.map((v) => <div className="data-row" key={v.id}><strong>{v.vital_type}: {v.value} {v.unit ?? ''}</strong><span>{v.measured_at ? new Date(v.measured_at).toLocaleDateString() : 'Date not recorded'} · page {v.source_page ?? '—'}</span></div>) : <Empty text="No vitals extracted yet." />}</div><div className="panel"><div className="panel-head"><div><p className="eyebrow">LAB RESULTS</p><h3>Latest values</h3></div><strong>{labs.length}</strong></div>{labs.length ? labs.slice(0, 20).map((lab) => <div className="data-row" key={lab.id}><strong>{lab.test_name_raw}: {lab.value_text ?? lab.numeric_value ?? '—'} {lab.unit ?? ''}</strong><span>{lab.measured_at ? new Date(lab.measured_at).toLocaleDateString() : 'Date not recorded'} · page {lab.source_page ?? '—'}</span></div>) : <Empty text="Lab results will appear here after extraction." />}</div></div></Page>
    : activeTab === 'Ask the archive' ? <Page title="Ask the archive" eyebrow="CITED SEARCH"><div className="panel full-panel ask-panel"><Search size={25} /><h3>Search across this patient’s records</h3><p className="muted">Answers use only indexed records and include source references. This is an archive search, not a diagnosis.</p><form className="ask-placeholder" onSubmit={askArchive}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What lab values changed over time?" disabled={asking} /><button className="primary" type="submit" disabled={asking || !question.trim()}>{asking ? 'Searching…' : 'Search archive'}</button></form>{answer && <div className="answer-box"><strong>Archive answer</strong><p>{answer}</p></div>}</div></Page>
    : <Overview patient={activePatient} documents={documents} vitals={vitals} events={events} processingLabel={processingLabel} processingIcon={processingIcon} navigate={navigate} />

  const pageContent = activeTab === 'Vitals & labs' ? <VitalsPage labs={labs} vitals={vitals} patient={activePatient} /> : activeTab === 'Ask the archive' ? <AskArchivePage question={question} setQuestion={setQuestion} asking={asking} answer={answer} citations={citations} onAsk={askArchive} onOpenSource={openSource} /> : legacyPage
  const page = <><button className="mobile-menu-button" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /> <span>Menu</span></button>{mobileSidebarOpen && <button className="mobile-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close navigation" />}{pageContent}</>
  if (recoveryMode && supabase) return <PasswordRecoveryModal newPassword={newPassword} confirmPassword={confirmPassword} setNewPassword={setNewPassword} setConfirmPassword={setConfirmPassword} authBusy={authBusy} notice={notice} onSubmit={updatePassword} />

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><HeartPulse size={19} /></div><div><strong>Care Archive</strong><span>family health records</span></div></div><div className="side-section"><p className="side-label">WORKSPACE</p>{tabs.map((tab) => <button className={activeTab === tab ? 'side-link active' : 'side-link'} key={tab} onClick={() => navigate(tab)}>{tab === 'Documents' ? <FileText size={16} /> : tab === 'Vitals & labs' ? <Activity size={16} /> : tab === 'Ask the archive' ? <Search size={16} /> : <HeartPulse size={16} />}{tab}</button>)}</div><div className="side-bottom"><div className="privacy"><ShieldCheck size={17} /><span><strong>Private by default</strong><small>Source pages stay attached to every fact.</small></span></div>{sessionEmail && <button className="text-button" onClick={() => supabase?.auth.signOut()}>Sign out</button>}</div></aside><main className="main"><header className="topbar"><div><p className="eyebrow">YOUR ARCHIVE</p><h2>{activeTab}</h2></div><div className="top-actions">{sessionEmail && <span className="account"><UserRound size={15} /> {sessionEmail}</span>}<label className={uploadingFiles ? 'upload-button disabled' : 'upload-button'}><Upload size={16} /> {uploadingFiles ? `Uploading ${uploadProgress}/${uploadTotal}` : 'Upload files'}<input type="file" multiple accept="application/pdf,image/*" onChange={uploadFiles} disabled={uploadingFiles} /></label></div></header><section className="patient-bar"><div><span className="field-label">PATIENT PROFILE</span><select value={selectedPatient} onChange={(e) => setSelectedPatient(e.target.value)}>{displayPatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.display_name}</option>)}</select></div><button className="secondary" onClick={() => { setPatientName(''); setPatientDob(''); setPatientSex(''); setShowProfileForm(true) }} disabled={!supabase}><Plus size={16} /> New profile</button></section>{notice && <div className="notice banner">{notice}</div>}{page}</main>{showProfileForm && supabase && <div className="modal-backdrop"><section className="profile-modal" role="dialog" aria-modal="true"><div className="modal-icon"><UserRound size={20} /></div><p className="eyebrow">WELCOME TO CARE ARCHIVE</p><h2>Who are these records for?</h2><p className="muted">Optional demographics enable more relevant reference bands.</p><form onSubmit={createPatient}><label className="modal-label" htmlFor="patient-name">Patient name</label><input id="patient-name" autoFocus required placeholder="e.g. Mom, Dad, or Priya" value={patientName} onChange={(e) => setPatientName(e.target.value)} /><label className="modal-label" htmlFor="patient-dob">Date of birth (optional)</label><input id="patient-dob" type="date" value={patientDob} onChange={(e) => setPatientDob(e.target.value)} /><label className="modal-label" htmlFor="patient-sex">Sex for reference ranges (optional)</label><select id="patient-sex" value={patientSex} onChange={(e) => setPatientSex(e.target.value)}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option></select><div className="modal-actions">{patients.length > 0 && <button type="button" className="secondary" onClick={() => setShowProfileForm(false)}>Cancel</button>}<button type="submit" className="primary" disabled={creatingPatient}>{creatingPatient ? 'Creating…' : 'Create profile'}</button></div></form></section></div>}</div>
}

function PasswordRecoveryModal({ newPassword, confirmPassword, setNewPassword, setConfirmPassword, authBusy, notice, onSubmit }: { newPassword: string; confirmPassword: string; setNewPassword: (value: string) => void; setConfirmPassword: (value: string) => void; authBusy: boolean; notice: string; onSubmit: (event: React.FormEvent) => void }) { return <div className="auth-shell"><section className="auth-card recovery-card"><div className="brand-mark"><HeartPulse size={22} /></div><p className="eyebrow">PASSWORD RESET</p><h1>Choose a new password.</h1><p className="muted">Set a new password for your Care Archive account.</p><form className="login-form" onSubmit={onSubmit}><label htmlFor="new-password">New password</label><input id="new-password" type="password" minLength={6} required autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" /><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" minLength={6} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" /><button className="primary full" type="submit" disabled={authBusy}>{authBusy ? 'Updating…' : 'Update password'}</button></form>{notice && <p className="notice">{notice}</p>}</section></div> }
function VisitPage({ events }: { events: MedicalEvent[] }) { const visits = events.filter((event) => event.event_type === 'appointment' || event.event_type === 'consultation' || event.event_type === 'procedure'); const byDoctor = new Map<string, number>(); for (const visit of visits) { const name = visit.doctor_name || visit.facility || 'Doctor not recorded'; byDoctor.set(name, (byDoctor.get(name) ?? 0) + 1) } return <Page title="Doctors & visits" eyebrow="CARE TIMELINE"><div className="content-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">VISIT SUMMARY</p><h3>Who was visited</h3></div><strong>{visits.length}</strong></div>{byDoctor.size ? [...byDoctor.entries()].map(([name, count]) => <div className="data-row" key={name}><strong>{name}</strong><span>{count} visit{count === 1 ? '' : 's'}</span></div>) : <Empty text="Doctor visits and facilities will appear here when the records contain them." />}</section><section className="panel"><div className="panel-head"><div><p className="eyebrow">CHRONOLOGICAL VIEW</p><h3>Visits and procedures</h3></div></div>{visits.length ? <div className="timeline-list">{visits.map((event) => <div className="timeline-item" key={event.id}><span className="timeline-date">{event.event_date ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString() : 'Date unknown'}</span><div><strong>{event.doctor_name || event.title}</strong><span>{[event.specialty, event.facility, event.visit_reason || event.summary].filter(Boolean).join(' · ') || event.event_type}</span><small>Source page {event.source_page ?? '—'}</small></div></div>)}</div> : <Empty text="No dated visits or procedures extracted yet." />}</section></div></Page> }
function Page({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) { return <section className="page"><div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{title === 'Document library' ? 'Review upload status and source files.' : 'Everything extracted from the selected patient profile.'}</p></div>{children}</section> }
function Empty({ text }: { text: string }) { return <div className="empty"><FileText size={23} /><strong>Nothing here yet</strong><span>{text}</span></div> }
function testKey(name: string) { return name.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/\s+in\s+.*/g, '').replace(/[^a-z0-9]+/g, ' ').trim() }
function patientAge(dob?: string | null) { if (!dob) return null; const birth = new Date(dob); const now = new Date(); let age = now.getFullYear() - birth.getFullYear(); if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age--; return age }
function generalRange(name: string, unit: string | null, age: number | null, sex?: string | null): [number, number] | null {
  const key = testKey(name); const u = (unit ?? '').toLowerCase();
  if (key === 'glucose' && u.includes('mg/dl')) return [70, 99]
  if (key === 'creatinine' && u.includes('mg/dl')) return sex === 'female' ? [0.5, 1.1] : [0.7, 1.3]
  if (key === 'sodium' && u.includes('mmol')) return [135, 145]
  if (key === 'potassium' && u.includes('mmol')) return [3.5, 5.1]
  if (key === 'calcium' && u.includes('mg/dl')) return [8.5, 10.5]
  if (key === 'hemoglobin' && u.includes('g/dl')) return sex === 'female' ? [12, 16] : [13.5, 17.5]
  if (key === 'hematocrit' && u.includes('%')) return sex === 'female' ? [36, 46] : [41, 53]
  if (key === 'leukocytes' && u.includes('10')) return [4, 11]
  if (key === 'platelets' && u.includes('10')) return [150, 450]
  return null
}
function VitalsPage({ labs, vitals, patient }: { labs: LabResult[]; vitals: Vital[]; patient?: PatientProfile }) {
  const groups = new Map<string, { name: string; unit: string | null; points: Array<{ date: string; value: number }> }>()
  for (const lab of labs) if (lab.numeric_value != null && lab.measured_at) { const key = testKey(lab.test_name_normalized || lab.test_name_raw); const current = groups.get(key) ?? { name: lab.test_name_normalized || lab.test_name_raw, unit: lab.unit, points: [] }; current.points.push({ date: lab.measured_at, value: lab.numeric_value }); groups.set(key, current) }
  for (const vital of vitals) if (vital.measured_at) { const key = testKey(vital.vital_type); const current = groups.get(key) ?? { name: vital.vital_type, unit: vital.unit, points: [] }; current.points.push({ date: vital.measured_at, value: vital.value }); groups.set(key, current) }
  const trends = [...groups.values()].filter((group) => group.points.length > 1).sort((a, b) => a.name.localeCompare(b.name))
  const age = patientAge(patient?.date_of_birth)
  return <Page title="Vitals & labs" eyebrow="STRUCTURED HISTORY"><div className="reference-note">Reference bands are general adult guides, not diagnoses. Prefer the range printed on the original report; age-specific ranges require a recorded date of birth.</div>{trends.length > 0 && <section className="trend-grid">{trends.map((trend) => <TrendChart key={`${trend.name}-${trend.unit}`} trend={trend} age={age} sex={patient?.biological_sex} />)}</section>}<div className="content-grid"><div className="panel"><div className="panel-head"><div><p className="eyebrow">VITALS</p><h3>Measurements</h3></div><strong>{vitals.length}</strong></div>{vitals.length ? vitals.map((v) => <div className="data-row" key={v.id}><strong>{v.vital_type}: {v.value} {v.unit ?? ''}</strong><span>{v.measured_at ? new Date(v.measured_at).toLocaleDateString() : 'Date not recorded'} · page {v.source_page ?? '—'}</span></div>) : <Empty text="No vitals extracted yet. Lab trends appear above when repeated values are available." />}</div><div className="panel"><div className="panel-head"><div><p className="eyebrow">LAB RESULTS</p><h3>Latest values</h3></div><strong>{labs.length}</strong></div>{labs.length ? labs.slice(0, 20).map((lab) => <div className="data-row" key={lab.id}><strong>{lab.test_name_raw}: {lab.value_text ?? lab.numeric_value ?? '—'} {lab.unit ?? ''}</strong><span>{lab.measured_at ? new Date(lab.measured_at).toLocaleDateString() : 'Date not recorded'} · page {lab.source_page ?? '—'}</span></div>) : <Empty text="Lab results will appear here after extraction." />}</div></div></Page>
}
function TrendChart({ trend, age, sex }: { trend: { name: string; unit: string | null; points: { date: string; value: number }[] }; age: number | null; sex?: string | null }) {
  const points = [...trend.points].sort((a, b) => a.date.localeCompare(b.date)); const range = generalRange(trend.name, trend.unit, age, sex); const values = points.map((point) => point.value); const min = Math.min(...values, ...(range ? [range[0]] : [])); const max = Math.max(...values, ...(range ? [range[1]] : [])); const padding = Math.max((max - min) * 0.15, 0.1); const low = min - padding; const high = max + padding; const x = (index: number) => 48 + (index * 560) / Math.max(points.length - 1, 1); const y = (value: number) => 205 - ((value - low) / (high - low || 1)) * 165; const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
  return <article className="panel trend-card"><div className="panel-head"><div><p className="eyebrow">TREND</p><h3>{trend.name}</h3></div><span className="muted">{trend.unit ?? ''}</span></div><svg viewBox="0 0 640 240" role="img" aria-label={`${trend.name} over time`} className="trend-svg"><line x1="48" y1="205" x2="608" y2="205" className="chart-axis" />{range && <><rect x="48" y={y(range[1])} width="560" height={Math.max(y(range[0]) - y(range[1]), 1)} className="reference-band" /><text x="52" y={y(range[1]) - 6} className="chart-label">general range {range[0]}–{range[1]}</text></>}<polyline points={line} className="trend-line" />{points.map((point, index) => <g key={`${point.date}-${index}`}><circle cx={x(index)} cy={y(point.value)} r="4" className="trend-dot" /><text x={x(index)} y="224" textAnchor="middle" className="chart-label">{new Date(point.date).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</text></g>)}</svg></article>
}
function AskArchivePage({ question, setQuestion, asking, answer, citations, onAsk, onOpenSource }: { question: string; setQuestion: (value: string) => void; asking: boolean; answer: string; citations: Array<{ document_id: string; page_start: number | null; page_end: number | null }>; onAsk: (event: React.FormEvent) => void; onOpenSource: (documentId: string) => void }) {
  const suggestions = ['What changed recently?', 'Show repeated lab values', 'What medicines are mentioned?']
  return <Page title="Ask the archive" eyebrow="CITED SEARCH"><div className="panel full-panel ask-panel"><div className="ask-heading"><div className="ask-icon"><Search size={24} /></div><div><h3>Search across this patient’s records</h3><p className="muted">Answers use indexed records, source pages, and only the selected patient’s data.</p></div></div><div className="suggestion-row">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="suggestion" onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}</div><form className="ask-placeholder" onSubmit={onAsk}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about labs, medicines, dates, or changes…" disabled={asking} /><button className="primary" type="submit" disabled={asking || !question.trim()}>{asking ? <><LoaderCircle className="spin" size={15} /> Searching</> : <><Search size={15} /> Search archive</>}</button></form>{answer ? <div className="answer-box"><div className="answer-title"><strong>Archive answer</strong><span>Source-grounded</span></div><p>{answer}</p>{citations.length > 0 && <div className="citation-list"><strong>Sources</strong>{citations.map((citation, index) => <button type="button" className="citation-link" key={`${citation.document_id}-${index}`} onClick={() => onOpenSource(citation.document_id)}><span>Document {citation.document_id.slice(0, 8)}</span><small>page {citation.page_start ?? '—'}{citation.page_end && citation.page_end !== citation.page_start ? `–${citation.page_end}` : ''} · Open source</small></button>)}</div>}</div> : <div className="ask-empty"><Search size={20} /><span>Ask a question to compare records, find dates, or trace repeated measurements.</span></div>}</div></Page>
}
function Overview({ patient, documents, vitals, events, processingLabel, processingIcon, navigate }: { patient?: PatientProfile; documents: DocumentRecord[]; vitals: Vital[]; events: MedicalEvent[]; processingLabel: (s: string) => string; processingIcon: (s: string) => React.ReactNode; navigate: (s: string) => void }) { return <section className="page"><section className="hero"><div><p className="eyebrow">{patient?.display_name ?? 'WELCOME'}</p><h1>The clearest picture of care, over time.</h1><p className="muted">Upload historical records and turn scattered pages into a cited, searchable timeline.</p></div><div className="hero-orb"><HeartPulse size={38} /></div></section><div className="stat-grid"><article className="stat-card"><div className="stat-icon blue"><FileText size={18} /></div><span>Documents</span><strong>{documents.length}</strong><small>Uploaded to this profile</small></article><article className="stat-card"><div className="stat-icon green"><Activity size={18} /></div><span>Vitals captured</span><strong>{vitals.length}</strong><small>With source references</small></article><article className="stat-card"><div className="stat-icon amber"><HeartPulse size={18} /></div><span>Processing</span><strong>{documents.filter((d) => !['indexed', 'validated'].includes(d.processing_status)).length}</strong><small>Automatic backend queue</small></article></div><section className="content-grid"><article className="panel"><div className="panel-head"><div><p className="eyebrow">RECENT RECORDS</p><h3>Document library</h3></div><button className="icon-button" onClick={() => navigate('Documents')} aria-label="Open documents"><Search size={17} /></button></div>{documents.length ? <div className="document-list">{documents.slice(0, 6).map((doc) => <div className="document-row" key={doc.id}><div className="file-icon"><FileText size={17} /></div><div className="document-name"><strong>{doc.original_filename}</strong><span>{doc.content_classification === 'non_medical' ? 'Rejected: non-medical content' : doc.document_type ?? 'Awaiting classification'}</span></div><span className={`status ${doc.processing_status}`}>{processingIcon(doc.processing_status)} {doc.content_classification === 'non_medical' ? 'Rejected' : processingLabel(doc.processing_status)}</span></div>)}</div> : <Empty text="Upload a PDF or a clear photo of a medical page." />}</article><article className="panel"><div className="panel-head"><div><p className="eyebrow">CARE TIMELINE</p><h3>Doctors and visits</h3></div><span className="muted">{events.length} event{events.length === 1 ? '' : 's'}</span></div>{events.length ? <div className="timeline-list">{events.slice(0, 8).map((event) => <div className="timeline-item" key={event.id}><span className="timeline-date">{event.event_date ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString() : 'Date unknown'}</span><div><strong>{event.doctor_name || event.title}</strong><span>{[event.specialty, event.facility, event.visit_reason || event.summary].filter(Boolean).join(' · ') || event.event_type}</span><small>Source page {event.source_page ?? '—'}</small></div></div>)}</div> : <Empty text="Doctors, facilities, visits, and procedures will appear here after extraction." />}</article></section></section> }

export default App
