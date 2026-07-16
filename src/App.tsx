import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Clock3, FileText, HeartPulse, LoaderCircle, LogIn, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'
import type { DocumentRecord, LabResult, Medication, PatientProfile, Vital } from './types'

const tabs = ['Overview', 'Documents', 'Medicines', 'Vitals & labs', 'Ask the archive']
const demoPatients: PatientProfile[] = [{ id: 'demo', display_name: 'Create your first patient profile' }]

function App() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [patients, setPatients] = useState<PatientProfile[]>([])
  const [selectedPatient, setSelectedPatient] = useState('')
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [vitals, setVitals] = useState<Vital[]>([])
  const [labs, setLabs] = useState<LabResult[]>([])
  const [medicines, setMedicines] = useState<Medication[]>([])
  const [activeTab, setActiveTab] = useState(() => tabFromHash())
  const [showLogin, setShowLogin] = useState(false)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [patientName, setPatientName] = useState('')
  const [creatingPatient, setCreatingPatient] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({})
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)

  function tabFromHash() {
    const hash = window.location.hash.replace('#', '')
    return tabs.find((tab) => tab.toLowerCase().replaceAll(' ', '-').replace('&-', '') === hash) ?? 'Overview'
  }

  function navigate(tab: string) {
    setActiveTab(tab)
    window.history.replaceState(null, '', `#${tab.toLowerCase().replaceAll(' ', '-').replace('&-', '')}`)
  }

  useEffect(() => {
    const onHash = () => setActiveTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    if (!supabase) return () => window.removeEventListener('hashchange', onHash)
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, current) => setSessionEmail(current?.user.email ?? null))
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
    const [docs, vitalRows, labRows, medRows] = await Promise.all([
      supabase.from('documents').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('vitals').select('*').eq('patient_id', patientId).order('measured_at', { ascending: false }).limit(50),
      supabase.from('lab_results').select('*').eq('patient_id', patientId).order('measured_at', { ascending: false }).limit(100),
      supabase.from('medications').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    ])
    if (!docs.error) setDocuments((docs.data ?? []) as DocumentRecord[])
    if (!vitalRows.error) setVitals((vitalRows.data ?? []) as Vital[])
    if (!labRows.error) setLabs((labRows.data ?? []) as LabResult[])
    if (!medRows.error) setMedicines((medRows.data ?? []) as Medication[])
    if (!docs.error && docs.data?.length) {
      const jobs = await supabase.from('extraction_jobs').select('document_id, error_message, created_at').in('document_id', docs.data.map((doc) => doc.id)).order('created_at', { ascending: false })
      if (!jobs.error) {
        const errors: Record<string, string> = {}
        for (const job of jobs.data ?? []) if (job.error_message && !errors[job.document_id]) errors[job.document_id] = job.error_message
        setDocumentErrors(errors)
      }
    }
  }

  async function loadPatients() {
    if (!supabase) return
    const { data, error } = await supabase.from('patient_profiles').select('id, display_name, created_at').order('created_at')
    if (error) setNotice(error.message)
    else { setPatients((data ?? []) as PatientProfile[]); if (data?.[0]) setSelectedPatient(data[0].id); else setShowProfileForm(true) }
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setNotice(error ? error.message : 'Check your email for the secure sign-in link.'); if (!error) setShowLogin(false)
  }

  async function createPatient(event?: React.FormEvent) {
    event?.preventDefault(); const name = patientName.trim()
    if (!name || !supabase || creatingPatient) return
    setCreatingPatient(true)
    const { data, error } = await supabase.rpc('create_patient_profile', { profile_name: name })
    setCreatingPatient(false)
    if (error) setNotice(error.message)
    else if (data) { setPatients((current) => [...current, data as PatientProfile]); setSelectedPatient(data.id); setPatientName(''); setShowProfileForm(false); setNotice('Patient profile created.') }
  }

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!supabase || !selectedPatient || !files.length || uploadingFiles) return
    setUploadingFiles(true); setUploadProgress(0); setUploadTotal(files.length); setNotice(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`)
    let done = 0
    for (const file of files) {
      const id = crypto.randomUUID(); const path = `${selectedPatient}/${id}/${file.name}`
      const upload = await supabase.storage.from('medical-documents').upload(path, file, { upsert: false })
      if (upload.error) setNotice(`${file.name}: ${upload.error.message}`)
      else {
        const { data: userData } = await supabase.auth.getUser()
        const insert = await supabase.from('documents').insert({ id, patient_id: selectedPatient, original_filename: file.name, storage_path: path, processing_status: 'queued', created_by: userData.user?.id })
        if (insert.error) setNotice(`${file.name}: ${insert.error.message}`)
      }
      done += 1; setUploadProgress(done)
    }
    const { data: processingResult, error } = await supabase.functions.invoke('enqueue-gemini-batch')
    setUploadingFiles(false)
    const failedResult = processingResult?.results?.find((result: { status: string; error?: string }) => result.error || result.status === 'failed_retryable')
    setNotice(error ? `Files uploaded, but processing could not start: ${error.message}` : failedResult?.error ? `Upload completed, but processing failed: ${failedResult.error}` : 'Files uploaded and processing has started. This can take a few minutes on the free tier.')
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
    setDeletingDocumentId(document.id)
    const { error: updateError } = await supabase.from('documents').update({ processing_status: 'queued', processed_at: null }).eq('id', document.id)
    const { data: processingResult, error: functionError } = updateError ? { data: null, error: updateError } : await supabase.functions.invoke('enqueue-gemini-batch')
    setDeletingDocumentId(null)
    const result = processingResult?.results?.find((item: { id: string }) => item.id === document.id)
    setNotice(updateError || functionError ? `Could not restart processing: ${(updateError ?? functionError)?.message}` : result?.error ? `Extraction completed, but indexing reported: ${result.error}` : result?.status === 'indexed' ? 'Processing complete. The document is now searchable.' : 'Processing restarted. Check the document status for the backend result.')
    await refreshPatientData(selectedPatient)
  }

  async function askArchive(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !selectedPatient || !question.trim() || asking) return
    setAsking(true); setAnswer('')
    const { data, error } = await supabase.functions.invoke('ask-archive', { body: { patient_id: selectedPatient, question: question.trim() } })
    setAsking(false)
    if (error) setNotice(`Archive search failed: ${error.message}`)
    else if (data?.error) setNotice(`Archive search failed: ${data.error}`)
    else { setAnswer(data?.answer ?? 'No answer returned.'); setNotice('Answer generated from indexed records.') }
  }

  function processingLabel(status: string) { return ({ queued: 'Queued', batch_submitted: 'Batch submitted', processing: 'Processing', validated: 'Extracted', indexed: 'Searchable', failed_retryable: 'Retrying', failed_permanent: 'Needs retry' } as Record<string, string>)[status] ?? status }
  function processingIcon(status: string) { if (status === 'indexed' || status === 'validated') return <CheckCircle2 size={13} />; if (status.includes('failed')) return <AlertCircle size={13} />; if (status === 'processing' || status === 'batch_submitted') return <LoaderCircle className="spin" size={13} />; return <Clock3 size={13} /> }
  const activePatient = useMemo(() => patients.find((p) => p.id === selectedPatient), [patients, selectedPatient])
  const displayPatients = supabaseConfigured ? patients : demoPatients

  if (!sessionEmail && supabaseConfigured) return <div className="auth-shell"><div className="auth-card"><div className="brand-mark"><HeartPulse size={22} /></div><p className="eyebrow">PRIVATE HEALTH ARCHIVE</p><h1>Keep the record together.</h1><p className="muted">A secure family workspace for documents, medicines, vitals, and timelines.</p><button className="primary full" onClick={() => setShowLogin(true)}><LogIn size={17} /> Sign in with email</button><p className="tiny">Each account only sees its own patient profiles.</p>{showLogin && <form className="login-form" onSubmit={sendMagicLink}><input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="primary full" type="submit">Send secure link</button></form>}{notice && <p className="notice">{notice}</p>}</div></div>

  const documentList = <div className="document-list">{documents.map((doc) => <div className="document-row" key={doc.id}><div className="file-icon"><FileText size={17} /></div><div className="document-name"><strong>{doc.original_filename}</strong><span>{documentErrors[doc.id] ? 'Indexing needs retry' : doc.document_type ?? 'Awaiting classification'}</span></div><span className={`status ${doc.processing_status}`} title={documentErrors[doc.id]}>{processingIcon(doc.processing_status)} {documentErrors[doc.id] ? 'Needs retry' : processingLabel(doc.processing_status)}</span>{doc.processing_status !== 'indexed' && <button className="retry-button" onClick={() => retryDocument(doc)} disabled={deletingDocumentId === doc.id} aria-label="Retry processing" title="Retry processing"><RefreshCw size={14} /></button>}<button className="delete-button" onClick={() => deleteDocument(doc)} disabled={deletingDocumentId === doc.id} aria-label={`Delete ${doc.original_filename}`} title="Delete document">{deletingDocumentId === doc.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button></div>)}</div>
  const page = activeTab === 'Documents' ? <Page title="Document library" eyebrow="YOUR RECORDS"><div className="panel full-panel"><div className="panel-head"><div><p className="eyebrow">SOURCE FILES</p><h3>Every uploaded record</h3></div><span className="muted">{documents.length} file{documents.length === 1 ? '' : 's'}</span></div>{documents.length ? documentList : <Empty text="Upload a PDF or a clear photo of a medical page." />}</div></Page>
    : activeTab === 'Medicines' ? <Page title="Medicines" eyebrow="MEDICATION HISTORY"><div className="panel full-panel"><div className="panel-head"><div><p className="eyebrow">EXTRACTED MEDICINES</p><h3>Prescribed or mentioned</h3></div></div>{medicines.length ? medicines.map((med) => <div className="data-row" key={med.id}><strong>{med.brand_name || med.generic_name || 'Unnamed medicine'}</strong><span>{[med.generic_name, med.strength, med.dosage_form, med.route].filter(Boolean).join(' · ') || 'Details pending'}</span></div>) : <Empty text="Medicines will appear here when the extraction pipeline finds them." />}</div></Page>
    : activeTab === 'Vitals & labs' ? <Page title="Vitals & labs" eyebrow="STRUCTURED HISTORY"><div className="content-grid"><div className="panel"><div className="panel-head"><div><p className="eyebrow">VITALS</p><h3>Measurements</h3></div><strong>{vitals.length}</strong></div>{vitals.length ? vitals.map((v) => <div className="data-row" key={v.id}><strong>{v.vital_type}: {v.value} {v.unit ?? ''}</strong><span>{v.measured_at ? new Date(v.measured_at).toLocaleDateString() : 'Date not recorded'} · page {v.source_page ?? '—'}</span></div>) : <Empty text="No vitals extracted yet." />}</div><div className="panel"><div className="panel-head"><div><p className="eyebrow">LAB RESULTS</p><h3>Latest values</h3></div><strong>{labs.length}</strong></div>{labs.length ? labs.slice(0, 20).map((lab) => <div className="data-row" key={lab.id}><strong>{lab.test_name_raw}: {lab.value_text ?? lab.numeric_value ?? '—'} {lab.unit ?? ''}</strong><span>{lab.measured_at ? new Date(lab.measured_at).toLocaleDateString() : 'Date not recorded'} · page {lab.source_page ?? '—'}</span></div>) : <Empty text="Lab results will appear here after extraction." />}</div></div></Page>
    : activeTab === 'Ask the archive' ? <Page title="Ask the archive" eyebrow="CITED SEARCH"><div className="panel full-panel ask-panel"><Search size={25} /><h3>Search across this patient’s records</h3><p className="muted">Answers use only indexed records and include source references. This is an archive search, not a diagnosis.</p><form className="ask-placeholder" onSubmit={askArchive}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What lab values changed over time?" disabled={asking} /><button className="primary" type="submit" disabled={asking || !question.trim()}>{asking ? 'Searching…' : 'Search archive'}</button></form>{answer && <div className="answer-box"><strong>Archive answer</strong><p>{answer}</p></div>}</div></Page>
    : <Overview patient={activePatient} documents={documents} vitals={vitals} processingLabel={processingLabel} processingIcon={processingIcon} navigate={navigate} />

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><HeartPulse size={19} /></div><div><strong>Care Archive</strong><span>family health records</span></div></div><div className="side-section"><p className="side-label">WORKSPACE</p>{tabs.map((tab) => <button className={activeTab === tab ? 'side-link active' : 'side-link'} key={tab} onClick={() => navigate(tab)}>{tab === 'Documents' ? <FileText size={16} /> : tab === 'Vitals & labs' ? <Activity size={16} /> : tab === 'Ask the archive' ? <Search size={16} /> : <HeartPulse size={16} />}{tab}</button>)}</div><div className="side-bottom"><div className="privacy"><ShieldCheck size={17} /><span><strong>Private by default</strong><small>Source pages stay attached to every fact.</small></span></div>{sessionEmail && <button className="text-button" onClick={() => supabase?.auth.signOut()}>Sign out</button>}</div></aside><main className="main"><header className="topbar"><div><p className="eyebrow">YOUR ARCHIVE</p><h2>{activeTab}</h2></div><div className="top-actions">{sessionEmail && <span className="account"><UserRound size={15} /> {sessionEmail}</span>}<label className={uploadingFiles ? 'upload-button disabled' : 'upload-button'}><Upload size={16} /> {uploadingFiles ? `Uploading ${uploadProgress}/${uploadTotal}` : 'Upload files'}<input type="file" multiple accept="application/pdf,image/*" onChange={uploadFiles} disabled={uploadingFiles} /></label></div></header><section className="patient-bar"><div><span className="field-label">PATIENT PROFILE</span><select value={selectedPatient} onChange={(e) => setSelectedPatient(e.target.value)}>{displayPatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.display_name}</option>)}</select></div><button className="secondary" onClick={() => { setPatientName(''); setShowProfileForm(true) }} disabled={!supabase}><Plus size={16} /> New profile</button></section>{notice && <div className="notice banner">{notice}</div>}{page}</main>{showProfileForm && supabase && <div className="modal-backdrop"><section className="profile-modal" role="dialog" aria-modal="true"><div className="modal-icon"><UserRound size={20} /></div><p className="eyebrow">WELCOME TO CARE ARCHIVE</p><h2>Who are these records for?</h2><p className="muted">Start by creating a patient profile. You can add more profiles later.</p><form onSubmit={createPatient}><label className="modal-label" htmlFor="patient-name">Patient name</label><input id="patient-name" autoFocus required placeholder="e.g. Mom, Dad, or Priya" value={patientName} onChange={(e) => setPatientName(e.target.value)} /><div className="modal-actions">{patients.length > 0 && <button type="button" className="secondary" onClick={() => setShowProfileForm(false)}>Cancel</button>}<button type="submit" className="primary" disabled={creatingPatient}>{creatingPatient ? 'Creating…' : 'Create profile'}</button></div></form></section></div>}</div>
}

function Page({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) { return <section className="page"><div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{title === 'Document library' ? 'Review upload status and source files.' : 'Everything extracted from the selected patient profile.'}</p></div>{children}</section> }
function Empty({ text }: { text: string }) { return <div className="empty"><FileText size={23} /><strong>Nothing here yet</strong><span>{text}</span></div> }
function Overview({ patient, documents, vitals, processingLabel, processingIcon, navigate }: { patient?: PatientProfile; documents: DocumentRecord[]; vitals: Vital[]; processingLabel: (s: string) => string; processingIcon: (s: string) => React.ReactNode; navigate: (s: string) => void }) { return <section className="page"><section className="hero"><div><p className="eyebrow">{patient?.display_name ?? 'WELCOME'}</p><h1>The clearest picture of care, over time.</h1><p className="muted">Upload historical records and turn scattered pages into a cited, searchable timeline.</p></div><div className="hero-orb"><HeartPulse size={38} /></div></section><div className="stat-grid"><article className="stat-card"><div className="stat-icon blue"><FileText size={18} /></div><span>Documents</span><strong>{documents.length}</strong><small>Uploaded to this profile</small></article><article className="stat-card"><div className="stat-icon green"><Activity size={18} /></div><span>Vitals captured</span><strong>{vitals.length}</strong><small>With source references</small></article><article className="stat-card"><div className="stat-icon amber"><HeartPulse size={18} /></div><span>Processing</span><strong>{documents.filter((d) => !['indexed', 'validated'].includes(d.processing_status)).length}</strong><small>Automatic backend queue</small></article></div><section className="content-grid"><article className="panel"><div className="panel-head"><div><p className="eyebrow">RECENT RECORDS</p><h3>Document library</h3></div><button className="icon-button" onClick={() => navigate('Documents')} aria-label="Open documents"><Search size={17} /></button></div>{documents.length ? <div className="document-list">{documents.slice(0, 6).map((doc) => <div className="document-row" key={doc.id}><div className="file-icon"><FileText size={17} /></div><div className="document-name"><strong>{doc.original_filename}</strong><span>{doc.document_type ?? 'Awaiting classification'}</span></div><span className={`status ${doc.processing_status}`}>{processingIcon(doc.processing_status)} {processingLabel(doc.processing_status)}</span></div>)}</div> : <Empty text="Upload a PDF or a clear photo of a medical page." />}</article><article className="panel"><div className="panel-head"><div><p className="eyebrow">NEXT LAYER</p><h3>What gets built automatically</h3></div></div><div className="feature-list"><div><span className="number">01</span><p><strong>Extract</strong><br /><small>Dates, medicines, diagnoses, labs, vitals, and page evidence.</small></p></div><div><span className="number">02</span><p><strong>Organize</strong><br /><small>Timeline events and structured medical history.</small></p></div><div><span className="number">03</span><p><strong>Search</strong><br /><small>Ask questions across documents with citations.</small></p></div></div></article></section></section> }

export default App
