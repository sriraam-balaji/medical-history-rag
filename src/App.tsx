import { useEffect, useMemo, useState } from 'react'
import { Activity, FileText, HeartPulse, LogIn, Plus, Search, ShieldCheck, Upload, UserRound } from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'
import type { DocumentRecord, PatientProfile, Vital } from './types'

const demoPatients: PatientProfile[] = [{ id: 'demo', display_name: 'Create your first patient profile' }]

function App() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [patients, setPatients] = useState<PatientProfile[]>([])
  const [selectedPatient, setSelectedPatient] = useState<string>('')
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [vitals, setVitals] = useState<Vital[]>([])
  const [activeTab, setActiveTab] = useState('Overview')
  const [showLogin, setShowLogin] = useState(false)
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, current) => setSessionEmail(current?.user.email ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !sessionEmail) return
    loadPatients()
  }, [sessionEmail])

  useEffect(() => {
    if (!supabase || !selectedPatient) return
    Promise.all([
      supabase.from('documents').select('*').eq('patient_id', selectedPatient).order('created_at', { ascending: false }),
      supabase.from('vitals').select('*').eq('patient_id', selectedPatient).order('measured_at', { ascending: false }).limit(20),
    ]).then(([docResult, vitalResult]) => {
      if (!docResult.error) setDocuments((docResult.data ?? []) as DocumentRecord[])
      if (!vitalResult.error) setVitals((vitalResult.data ?? []) as Vital[])
    })
  }, [selectedPatient])

  async function loadPatients() {
    if (!supabase) return
    const { data, error } = await supabase.from('patient_profiles').select('id, display_name, created_at').order('created_at')
    if (error) setNotice(error.message)
    else {
      setPatients((data ?? []) as PatientProfile[])
      if (data?.[0]) setSelectedPatient(data[0].id)
    }
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setNotice(error ? error.message : 'Check your email for the secure sign-in link.')
    if (!error) setShowLogin(false)
  }

  async function createPatient() {
    const name = window.prompt('Patient profile name')?.trim()
    if (!name || !supabase) return
    const { data, error } = await supabase.from('patient_profiles').insert({ display_name: name }).select().single()
    if (error) setNotice(error.message)
    else if (data) {
      setPatients((current) => [...current, data as PatientProfile])
      setSelectedPatient(data.id)
      setNotice('Patient profile created.')
    }
  }

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!supabase || !selectedPatient || !files.length) return
    for (const file of files) {
      const id = crypto.randomUUID()
      const path = `${selectedPatient}/${id}/${file.name}`
      const upload = await supabase.storage.from('medical-documents').upload(path, file, { upsert: false })
      if (upload.error) { setNotice(upload.error.message); continue }
      const { data: userData } = await supabase.auth.getUser()
      const insert = await supabase.from('documents').insert({ id, patient_id: selectedPatient, original_filename: file.name, storage_path: path, processing_status: 'queued', created_by: userData.user?.id })
      if (insert.error) setNotice(insert.error.message)
    }
    const { error: enqueueError } = await supabase.functions.invoke('enqueue-gemini-batch')
    setNotice(enqueueError ? 'Files uploaded. Automatic processing will retry when Gemini is available.' : 'Files uploaded and queued for automatic processing.')
    const { data } = await supabase.from('documents').select('*').eq('patient_id', selectedPatient).order('created_at', { ascending: false })
    setDocuments((data ?? []) as DocumentRecord[])
  }

  const activePatient = useMemo(() => patients.find((p) => p.id === selectedPatient), [patients, selectedPatient])

  if (!sessionEmail && supabaseConfigured) {
    return <div className="auth-shell"><div className="auth-card"><div className="brand-mark"><HeartPulse size={22} /></div><p className="eyebrow">PRIVATE HEALTH ARCHIVE</p><h1>Keep the record together.</h1><p className="muted">A secure family workspace for documents, medicines, vitals, and timelines.</p><button className="primary full" onClick={() => setShowLogin(true)}><LogIn size={17} /> Sign in with email</button><p className="tiny">Each account only sees its own patient profiles.</p>{showLogin && <form className="login-form" onSubmit={sendMagicLink}><input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="primary full" type="submit">Send secure link</button></form>}{notice && <p className="notice">{notice}</p>}</div></div>
  }

  const displayPatients = supabaseConfigured ? patients : demoPatients
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><HeartPulse size={19} /></div><div><strong>Care Archive</strong><span>family health records</span></div></div><div className="side-section"><p className="side-label">WORKSPACE</p>{['Overview', 'Documents', 'Medicines', 'Vitals & labs', 'Ask the archive'].map((tab) => <button className={activeTab === tab ? 'side-link active' : 'side-link'} key={tab} onClick={() => setActiveTab(tab)}>{tab === 'Documents' ? <FileText size={16} /> : tab === 'Vitals & labs' ? <Activity size={16} /> : tab === 'Ask the archive' ? <Search size={16} /> : <HeartPulse size={16} />}{tab}</button>)}</div><div className="side-bottom"><div className="privacy"><ShieldCheck size={17} /><span><strong>Private by default</strong><small>Source pages stay attached to every fact.</small></span></div>{sessionEmail && <button className="text-button" onClick={() => supabase?.auth.signOut()}>Sign out</button>}</div></aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">YOUR ARCHIVE</p><h2>{activeTab}</h2></div><div className="top-actions">{sessionEmail && <span className="account"><UserRound size={15} /> {sessionEmail}</span>}<label className="upload-button"><Upload size={16} /> Upload files<input type="file" multiple accept="application/pdf,image/*" onChange={uploadFiles} /></label></div></header>
      <section className="patient-bar"><div><span className="field-label">PATIENT PROFILE</span><select value={selectedPatient} onChange={(e) => setSelectedPatient(e.target.value)}>{displayPatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.display_name}</option>)}</select></div><button className="secondary" onClick={createPatient} disabled={!supabase}><Plus size={16} /> New profile</button></section>
      {notice && <div className="notice banner">{notice}</div>}
      <section className="hero"><div><p className="eyebrow">{activePatient?.display_name ?? 'WELCOME'}</p><h1>The clearest picture of care, over time.</h1><p className="muted">Upload historical records and turn scattered pages into a cited, searchable timeline.</p></div><div className="hero-orb"><HeartPulse size={38} /></div></section>
      <div className="stat-grid"><article className="stat-card"><div className="stat-icon blue"><FileText size={18} /></div><span>Documents</span><strong>{documents.length}</strong><small>Uploaded to this profile</small></article><article className="stat-card"><div className="stat-icon green"><Activity size={18} /></div><span>Vitals captured</span><strong>{vitals.length}</strong><small>With source references</small></article><article className="stat-card"><div className="stat-icon amber"><HeartPulse size={18} /></div><span>Processing</span><strong>{documents.filter((d) => d.processing_status !== 'indexed').length}</strong><small>Automatic backend queue</small></article></div>
      <section className="content-grid"><article className="panel"><div className="panel-head"><div><p className="eyebrow">RECENT RECORDS</p><h3>Document library</h3></div><button className="icon-button" aria-label="Search documents"><Search size={17} /></button></div>{documents.length ? <div className="document-list">{documents.slice(0, 6).map((doc) => <div className="document-row" key={doc.id}><div className="file-icon"><FileText size={17} /></div><div className="document-name"><strong>{doc.original_filename}</strong><span>{doc.document_type ?? 'Awaiting classification'}</span></div><span className={`status ${doc.processing_status}`}>{doc.processing_status}</span></div>)}</div> : <div className="empty"><FileText size={23} /><strong>Your archive starts here</strong><span>Upload a PDF or a clear photo of a medical page.</span></div>}</article><article className="panel"><div className="panel-head"><div><p className="eyebrow">NEXT LAYER</p><h3>What gets built automatically</h3></div></div><div className="feature-list"><div><span className="number">01</span><p><strong>Extract</strong><br /><small>Dates, medicines, diagnoses, labs, vitals, and page evidence.</small></p></div><div><span className="number">02</span><p><strong>Organize</strong><br /><small>Timeline events and structured medical history.</small></p></div><div><span className="number">03</span><p><strong>Search</strong><br /><small>Ask questions across documents with citations.</small></p></div></div></article></section>
    </main>
  </div>
}

export default App
