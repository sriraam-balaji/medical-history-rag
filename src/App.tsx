import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Clock3, FileText, HeartPulse, LayoutDashboard, LoaderCircle, LogIn, Menu, Pencil, Pill, Plus, RefreshCw, Search, ShieldCheck, Stethoscope, Trash2, Upload, UserRound } from 'lucide-react'
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
  const [showLogin, setShowLogin] = useState(true)
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
    if (window.location.hash.includes('error_description=')) {
      const params = new URLSearchParams(window.location.hash.replace('#', ''))
      const desc = params.get('error_description') || 'Email link is invalid or has expired'
      setNotice(`${desc.replaceAll('+', ' ')}. Enter your email below and click "Forgot password?" for a fresh link.`)
    } else if (window.location.hash.includes('type=recovery') || window.location.hash.includes('access_token')) {
      setRecoveryMode(true)
    }
    if (!supabase) return () => window.removeEventListener('hashchange', onHash)
    supabase.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null))
    const { data } = supabase.auth.onAuthStateChange((event, current) => {
      setSessionEmail(current?.user.email ?? null)
      if (event === 'PASSWORD_RECOVERY' || (window.location.hash.includes('type=recovery') && !window.location.hash.includes('error'))) {
        setRecoveryMode(true)
      }
    })
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash) }
  }, [])

  useEffect(() => { if (supabase && sessionEmail) loadPatients() }, [sessionEmail])
  const hasPendingDocuments = documents.some((doc) => !['indexed', 'validated', 'failed_permanent'].includes(doc.processing_status))
  useEffect(() => {
    if (!supabase || !selectedPatient) return
    refreshPatientData(selectedPatient)
    // Poll fast only while extraction is running; slow down once everything is indexed.
    const timer = window.setInterval(() => refreshPatientData(selectedPatient), hasPendingDocuments ? 5000 : 30000)
    return () => window.clearInterval(timer)
  }, [selectedPatient, hasPendingDocuments])

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
    } else {
      setDocuments((docs.data ?? []) as DocumentRecord[])
    }
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
    event.preventDefault()
    if (!supabase) { setNotice('This deployment is not connected to a database. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY at build time (see README).'); return }
    if (authBusy) return
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

function readFileAsArrayBuffer(file: Blob | File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
      } else {
        reject(new Error('FileReader returned invalid result'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

async function prepareFileForUpload(file: File): Promise<{ blob: Blob; contentType: string; name: string }> {
  const lowerName = file.name.toLowerCase()
  const isPdf = lowerName.endsWith('.pdf') || file.type === 'application/pdf' || file.type === 'application/x-pdf' || file.type.includes('pdf')
  
  if (isPdf) {
    let name = file.name
    if (!name.toLowerCase().endsWith('.pdf')) {
      name = `${name}.pdf`
    }
    try {
      const buffer = await readFileAsArrayBuffer(file)
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' })
      return { blob, contentType: 'application/pdf', name }
    } catch (err) {
      console.warn('PDF FileReader error:', err)
      return { blob: file, contentType: 'application/pdf', name }
    }
  }

  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(file.name)
  if (isImage) {
    try {
      const bitmap = await createImageBitmap(file)
      const maxDim = 2560
      let { width, height } = bitmap
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, width, height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
        if (blob) {
          const newName = file.name.replace(/\.[^/.]+$/, '') + '.jpg'
          return { blob, contentType: 'image/jpeg', name: newName }
        }
      }
    } catch (err) {
      console.warn('Image optimization fallback:', err)
    }
  }
  
  try {
    const buffer = await readFileAsArrayBuffer(file)
    const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
    return { blob: new Blob([new Uint8Array(buffer)], { type: contentType }), contentType, name: file.name }
  } catch {
    return { blob: file, contentType: file.type || 'image/jpeg', name: file.name }
  }
}

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!supabase || !selectedPatient || !files.length || uploadingFiles) return
    const allowed = files.filter((file) =>
      file.type === 'application/pdf' ||
      file.type === 'application/x-pdf' ||
      file.type.includes('pdf') ||
      file.type.startsWith('image/') ||
      /\.(pdf|png|jpe?g|webp|heic)$/i.test(file.name)
    )
    if (allowed.length !== files.length) { setNotice('Only PDF files and images (JPG, PNG, WEBP, or HEIC) can be uploaded.'); return }
    setUploadingFiles(true); setUploadProgress(0); setUploadTotal(files.length); setNotice(`Selected ${files.length} file${files.length === 1 ? '' : 's'}. Processing & uploading…`)
    
    try {
      await supabase.auth.getSession()
    } catch (sessionErr) {
      console.warn('Auth session check notice:', sessionErr)
    }

    let done = 0
    let uploadedCount = 0
    const uploadErrors: string[] = []
    const newlyUploadedDocIds: string[] = []
    for (const file of files) {
      const id = crypto.randomUUID()
      const prepared = await prepareFileForUpload(file)
      const safeName = prepared.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
      const path = `${selectedPatient}/${id}/${safeName}`
      let upload: { error: { message: string } | null } = { error: null }
      
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await supabase.storage.from('medical-documents').upload(path, prepared.blob, {
            upsert: false,
            contentType: prepared.contentType,
            cacheControl: '3600',
          })
          if (result.error) {
            console.warn('Standard upload failed, trying signed upload URL fallback:', result.error)
            const { data: signedData } = await supabase.storage.from('medical-documents').createSignedUploadUrl(path)
            if (signedData?.token) {
              const signedResult = await supabase.storage.from('medical-documents').uploadToSignedUrl(path, signedData.token, prepared.blob, {
                contentType: prepared.contentType,
              })
              upload = { error: signedResult.error ? { message: signedResult.error.message } : null }
            } else {
              upload = { error: { message: result.error.message } }
            }
          } else {
            upload = { error: null }
          }
        } catch (err: any) {
          console.warn('Upload fetch exception, trying signed upload URL fallback:', err)
          try {
            const { data: signedData } = await supabase.storage.from('medical-documents').createSignedUploadUrl(path)
            if (signedData?.token) {
              const signedResult = await supabase.storage.from('medical-documents').uploadToSignedUrl(path, signedData.token, prepared.blob, {
                contentType: prepared.contentType,
              })
              upload = { error: signedResult.error ? { message: signedResult.error.message } : null }
            } else {
              upload = { error: { message: err?.message || 'Network fetch error' } }
            }
          } catch (signedErr: any) {
            upload = { error: { message: signedErr?.message || err?.message || 'Network fetch error' } }
          }
        }
        if (!upload.error) break
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 900 * attempt))
      }
      if (upload.error) uploadErrors.push(`${file.name}: ${upload.error.message}`)
      else {
        const { data: userData } = await supabase.auth.getUser()
        const insert = await supabase.from('documents').insert({ id, patient_id: selectedPatient, original_filename: file.name, storage_path: path, processing_status: 'queued', created_by: userData.user?.id })
        if (insert.error) uploadErrors.push(`${file.name}: ${insert.error.message}`)
        else {
          uploadedCount += 1
          newlyUploadedDocIds.push(id)
        }
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
    
    // Process each document individually to prevent wall-clock execution timeouts on batch processing
    let processed = 0
    setNotice(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}. Extracting lab trends & vitals (1/${uploadedCount})…`)
    await refreshPatientData(selectedPatient)

    for (const docId of newlyUploadedDocIds) {
      processed += 1
      setNotice(`Extracting lab trends & vitals (${processed}/${uploadedCount})…`)
      const { data: processingResult, error: processingError } = await supabase.functions
        .invoke('enqueue-gemini-batch', { body: { document_id: docId } })
        .catch((error) => ({ data: null, error }))
      await refreshPatientData(selectedPatient)
      if (processingError) {
        setNotice(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}, but extraction failed: ${processingError.message}. You can retry it from Documents.`)
        setUploadingFiles(false)
        return
      }
      if (processingResult?.error) {
        setNotice(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}, but extraction failed: ${processingResult.error}. You can retry it from Documents.`)
        setUploadingFiles(false)
        return
      }
    }

    setUploadingFiles(false)
    setNotice(`Successfully uploaded & extracted ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}! Check Vitals & Labs for updated trend graphs.`)
    event.target.value = ''
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
    const { error: updateError } = await supabase.from('documents').update({
      processing_status: 'queued',
      content_classification: 'medical_document',
      rejection_reason: null,
      processed_at: null,
      retry_count: (document.retry_count ?? 0) + 1
    }).eq('id', document.id)

    if (updateError) {
      setDeletingDocumentId(null)
      setNotice(`Could not queue document: ${updateError.message}`)
      return
    }

    setNotice(`Extraction in progress for “${document.original_filename}”… Parsing lab trends and vitals.`)
    const { data: processingResult, error: functionError } = await supabase.functions
      .invoke('enqueue-gemini-batch', { body: { document_id: document.id } })
      .catch((err) => ({ data: null, error: err }))
    setDeletingDocumentId(null)
    if (functionError) {
      setNotice('Document queued for backend processing.')
    } else {
      setNotice('Extraction completed! Check Vitals & Labs for updated trend graphs.')
    }
    await refreshPatientData(selectedPatient)
  }

  async function processAllQueuedDocuments() {
    if (!supabase || !selectedPatient) return
    const pendingDocs = documents.filter((d) => d.processing_status !== 'indexed')
    if (!pendingDocs.length) {
      setNotice('All uploaded documents are already processed.')
      return
    }

    let count = 0
    setNotice(`Processing ${pendingDocs.length} queued document${pendingDocs.length === 1 ? '' : 's'}…`)
    for (const doc of pendingDocs) {
      count += 1
      setNotice(`Extracting document ${count} of ${pendingDocs.length} (“${doc.original_filename}”)…`)
      const { data, error } = await supabase.functions
        .invoke('enqueue-gemini-batch', { body: { document_id: doc.id } })
        .catch((invokeError) => ({ data: null, error: invokeError }))
      await refreshPatientData(selectedPatient)
      if (error || data?.error) {
        setNotice(`Processing stopped for “${doc.original_filename}”: ${error?.message ?? data.error}. Retry it from Documents.`)
        return
      }
    }
    setNotice('Extraction completed for all queued documents!')
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

  async function openSource(documentId: string, page?: number | null) {
    if (!supabase) return
    const document = documents.find((item) => item.id === documentId)
    if (!document) { setNotice('The original source is not available in this profile.'); return }
    const { data, error } = await supabase.storage.from('medical-documents').createSignedUrl(document.storage_path, 600)
    if (error || !data?.signedUrl) { setNotice(`Could not open source: ${error?.message ?? 'source unavailable'}`); return }
    const pageHash = page && page > 0 ? `#page=${page}` : ''
    window.open(data.signedUrl + pageHash, '_blank', 'noopener,noreferrer')
  }

  function processingLabel(status: string) {
    return ({
      queued: 'Queued for extraction',
      batch_submitted: 'Processing with Gemini',
      processing: 'Extracting trends & labs...',
      validated: 'Extracted',
      indexed: 'Searchable & trended',
      failed_retryable: 'Needs retry',
      failed_permanent: 'Unreadable / non-medical'
    } as Record<string, string>)[status] ?? 'Processing'
  }
  function processingIcon(status: string) { if (status === 'indexed' || status === 'validated') return <CheckCircle2 size={13} />; return <LoaderCircle className="spin" size={13} /> }
  const activePatient = useMemo(() => patients.find((p) => p.id === selectedPatient), [patients, selectedPatient])
  const displayPatients = supabaseConfigured ? patients : demoPatients

  if (recoveryMode && supabase) return <PasswordRecoveryModal newPassword={newPassword} confirmPassword={confirmPassword} setNewPassword={setNewPassword} setConfirmPassword={setConfirmPassword} authBusy={authBusy} notice={notice} onSubmit={updatePassword} />
  if (!sessionEmail) return <div className="auth-shell"><div className="auth-card"><div className="brand-mark"><HeartPulse size={22} /></div><p className="eyebrow">PRIVATE HEALTH ARCHIVE</p><h1>Keep the record together.</h1><p className="muted">A secure family workspace for documents, medicines, vitals, and timelines.</p>{!showLogin && <button className="primary full" onClick={() => setShowLogin(true)}><LogIn size={17} /> Sign in or create account</button>}<p className="tiny">Each account only sees its own patient profiles.</p>{!supabaseConfigured && <p className="notice" style={{ marginTop: '16px' }}>This deployment is missing its Supabase configuration, so sign-in is disabled. If you are the site owner, set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and redeploy (see README).</p>}{showLogin && <form className="login-form" onSubmit={submitAuth}><div className="auth-mode"><button type="button" className={authMode === 'signin' ? 'selected' : ''} onClick={() => { setAuthMode('signin'); setNotice('') }}>Sign in</button><button type="button" className={authMode === 'signup' ? 'selected' : ''} onClick={() => { setAuthMode('signup'); setNotice('') }}>Create account</button></div><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" required minLength={6} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="primary full" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}</button><div className="auth-links"><button type="button" className="text-button" onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setNotice('') }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>{authMode === 'signin' && <button type="button" className="text-button" onClick={resetPassword} disabled={authBusy}>Forgot password?</button>}</div></form>}{notice && <p className="notice">{notice}</p>}</div></div>

  async function addMedication(brand: string, generic: string, strength: string, form: string) {
    if (!supabase || !selectedPatient) return
    if (!brand.trim() && !generic.trim()) { setNotice('Enter at least a brand or generic name.'); return }
    const { error } = await supabase.from('medications').insert({
      patient_id: selectedPatient,
      brand_name: brand.trim() || null,
      generic_name: generic.trim() || null,
      strength: strength.trim() || null,
      dosage_form: form.trim() || null,
      composition_status: 'manual',
      confidence: 1,
    })
    if (error) setNotice(`Could not add medicine: ${error.message}`)
    else {
      setNotice('Medicine added.')
      await refreshPatientData(selectedPatient)
    }
  }

  async function updateMedication(ids: string[], brand: string, generic: string, strength: string, form: string) {
    if (!supabase || !ids.length) return
    const { error } = await supabase.from('medications').update({
      brand_name: brand.trim() || null,
      generic_name: generic.trim() || null,
      strength: strength.trim() || null,
      dosage_form: form.trim() || null,
    }).in('id', ids)
    if (error) setNotice(`Could not update medicine: ${error.message}`)
    else {
      setNotice('Medicine details updated.')
      await refreshPatientData(selectedPatient)
    }
  }

  async function deleteMedication(ids: string[]) {
    if (!supabase || !ids.length) return
    if (ids.length > 1 && !window.confirm(`Delete this medicine from all ${ids.length} prescriptions it appears in?`)) return
    const { error } = await supabase.from('medications').delete().in('id', ids)
    if (error) setNotice(`Could not delete medicine: ${error.message}`)
    else {
      setNotice('Medicine deleted.')
      await refreshPatientData(selectedPatient)
    }
  }

  const documentList = (
    <div className="document-list">
      {documents.map((doc) => (
        <div className="document-row" key={doc.id}>
          <div className="file-icon"><FileText size={17} /></div>
          <div className="document-name">
            <strong>{doc.original_filename}</strong>
            <span>{doc.document_type || (doc.processing_status === 'indexed' ? 'Prescription / Medical record' : 'Processing document')}</span>
          </div>
          <span className={`status ${doc.processing_status}`}>{processingIcon(doc.processing_status)} {processingLabel(doc.processing_status)}</span>
          {doc.processing_status !== 'indexed' && (
            <button className="retry-button" onClick={() => retryDocument(doc)} disabled={deletingDocumentId === doc.id} aria-label="Re-extract document" title="Re-extract document">
              <RefreshCw size={14} />
            </button>
          )}
          <button className="delete-button" onClick={() => deleteDocument(doc)} disabled={deletingDocumentId === doc.id} aria-label={`Delete ${doc.original_filename}`} title="Delete document">
            {deletingDocumentId === doc.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
          </button>
        </div>
      ))}
    </div>
  )

  const legacyPage = activeTab === 'Documents' ? (
    <Page title="Document library" eyebrow="YOUR RECORDS">
      <div className="panel full-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">SOURCE FILES</p>
            <h3>Every uploaded record</h3>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="muted">{documents.length} file{documents.length === 1 ? '' : 's'}</span>
            {documents.some((d) => d.processing_status !== 'indexed') && (
              <button className="secondary small" onClick={processAllQueuedDocuments} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', padding: '4px 10px' }}>
                <RefreshCw size={13} /> Process all queued
              </button>
            )}
          </div>
        </div>
        {documents.length ? documentList : <Empty text="Upload a PDF or a clear photo of a medical page." />}
      </div>
    </Page>
  )
    : activeTab === 'Medicines' ? <MedicinesPage medicines={medicines} onAdd={addMedication} onEdit={updateMedication} onDelete={deleteMedication} />
    : activeTab === 'Doctors & visits' ? <VisitPage events={events} />
    : activeTab === 'Vitals & labs' ? <Page title="Vitals & labs" eyebrow="STRUCTURED HISTORY"><div className="content-grid"><div className="panel"><div className="panel-head"><div><p className="eyebrow">VITALS</p><h3>Measurements</h3></div><strong>{vitals.length}</strong></div>{vitals.length ? vitals.map((v) => <div className="data-row" key={v.id}><strong>{v.vital_type}: {v.value} {v.unit ?? ''}</strong><span>{v.measured_at ? new Date(v.measured_at).toLocaleDateString() : 'Date not recorded'} · page {v.source_page ?? '—'}</span></div>) : <Empty text="No vitals extracted yet." />}</div><div className="panel"><div className="panel-head"><div><p className="eyebrow">LAB RESULTS</p><h3>Latest values</h3></div><strong>{labs.length}</strong></div>{labs.length ? labs.slice(0, 20).map((lab) => <div className="data-row" key={lab.id}><strong>{lab.test_name_raw}: {lab.value_text ?? lab.numeric_value ?? '—'} {lab.unit ?? ''}</strong><span>{lab.measured_at ? new Date(lab.measured_at).toLocaleDateString() : 'Date not recorded'} · page {lab.source_page ?? '—'}</span></div>) : <Empty text="No blood test reports found in uploaded documents. Medicines, clinic visits & prescriptions captured." />}</div></div></Page>
    : activeTab === 'Ask the archive' ? <Page title="Ask the archive" eyebrow="CITED SEARCH"><div className="panel full-panel ask-panel"><Search size={25} /><h3>Search across this patient’s records</h3><p className="muted">Answers use only indexed records and include source references. This is an archive search, not a diagnosis.</p><form className="ask-placeholder" onSubmit={askArchive}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What lab values changed over time?" disabled={asking} /><button className="primary" type="submit" disabled={asking || !question.trim()}>{asking ? 'Searching…' : 'Search archive'}</button></form>{answer && <div className="answer-box"><strong>Archive answer</strong><p>{answer}</p></div>}</div></Page>
    : <Overview patient={activePatient} documents={documents} vitals={vitals} events={events} processingLabel={processingLabel} processingIcon={processingIcon} navigate={navigate} />

  const pageContent = activeTab === 'Vitals & labs' ? <VitalsPage labs={labs} vitals={vitals} patient={activePatient} /> : activeTab === 'Ask the archive' ? <AskArchivePage question={question} setQuestion={setQuestion} asking={asking} answer={answer} citations={citations} documents={documents} onAsk={askArchive} onOpenSource={openSource} /> : legacyPage
  const page = <><button className="mobile-menu-button" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /> <span>Menu</span></button>{mobileSidebarOpen && <button className="mobile-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close navigation" />}{pageContent}</>

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><HeartPulse size={19} /></div><div><strong>Care Archive</strong><span>family health records</span></div></div><div className="side-section"><p className="side-label">WORKSPACE</p>{tabs.map((tab) => <button className={activeTab === tab ? 'side-link active' : 'side-link'} key={tab} onClick={() => navigate(tab)}>{tab === 'Documents' ? <FileText size={16} /> : tab === 'Medicines' ? <Pill size={16} /> : tab === 'Doctors & visits' ? <Stethoscope size={16} /> : tab === 'Vitals & labs' ? <Activity size={16} /> : tab === 'Ask the archive' ? <Search size={16} /> : <LayoutDashboard size={16} />}{tab}</button>)}</div><div className="side-bottom"><div className="privacy"><ShieldCheck size={17} /><span><strong>Private by default</strong><small>Source pages stay attached to every fact.</small></span></div>{sessionEmail && <button className="text-button" onClick={() => supabase?.auth.signOut()}>Sign out</button>}</div></aside><main className="main"><header className="topbar"><div><p className="eyebrow">YOUR ARCHIVE</p><h2>{activeTab}</h2></div><div className="top-actions">{sessionEmail && <span className="account"><UserRound size={15} /> {sessionEmail}</span>}<label className={uploadingFiles ? 'upload-button disabled' : 'upload-button'}><Upload size={16} /> {uploadingFiles ? `Uploading ${uploadProgress}/${uploadTotal}` : 'Upload files'}<input type="file" multiple accept="application/pdf,image/*" onChange={uploadFiles} disabled={uploadingFiles} /></label></div></header><section className="patient-bar"><div><span className="field-label">PATIENT PROFILE</span><select value={selectedPatient} onChange={(e) => setSelectedPatient(e.target.value)}>{displayPatients.map((patient) => <option key={patient.id} value={patient.id}>{patient.display_name}</option>)}</select></div><button className="secondary" onClick={() => { setPatientName(''); setPatientDob(''); setPatientSex(''); setShowProfileForm(true) }} disabled={!supabase}><Plus size={16} /> New profile</button></section>{notice && <div className="notice banner">{notice}</div>}{page}</main>{showProfileForm && supabase && <div className="modal-backdrop"><section className="profile-modal" role="dialog" aria-modal="true"><div className="modal-icon"><UserRound size={20} /></div><p className="eyebrow">WELCOME TO CARE ARCHIVE</p><h2>Who are these records for?</h2><p className="muted">Optional demographics enable more relevant reference bands.</p><form onSubmit={createPatient}><label className="modal-label" htmlFor="patient-name">Patient name</label><input id="patient-name" autoFocus required placeholder="e.g. Mom, Dad, or Priya" value={patientName} onChange={(e) => setPatientName(e.target.value)} /><label className="modal-label" htmlFor="patient-dob">Date of birth (optional)</label><input id="patient-dob" type="date" value={patientDob} onChange={(e) => setPatientDob(e.target.value)} /><label className="modal-label" htmlFor="patient-sex">Sex for reference ranges (optional)</label><select id="patient-sex" value={patientSex} onChange={(e) => setPatientSex(e.target.value)}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option></select><div className="modal-actions">{patients.length > 0 && <button type="button" className="secondary" onClick={() => setShowProfileForm(false)}>Cancel</button>}<button type="submit" className="primary" disabled={creatingPatient}>{creatingPatient ? 'Creating…' : 'Create profile'}</button></div></form></section></div>}</div>
}

function PasswordRecoveryModal({ newPassword, confirmPassword, setNewPassword, setConfirmPassword, authBusy, notice, onSubmit }: { newPassword: string; confirmPassword: string; setNewPassword: (value: string) => void; setConfirmPassword: (value: string) => void; authBusy: boolean; notice: string; onSubmit: (event: React.FormEvent) => void }) { return <div className="auth-shell"><section className="auth-card recovery-card"><div className="brand-mark"><HeartPulse size={22} /></div><p className="eyebrow">PASSWORD RESET</p><h1>Choose a new password.</h1><p className="muted">Set a new password for your Care Archive account.</p><form className="login-form" onSubmit={onSubmit}><label htmlFor="new-password">New password</label><input id="new-password" type="password" minLength={6} required autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" /><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" minLength={6} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" /><button className="primary full" type="submit" disabled={authBusy}>{authBusy ? 'Updating…' : 'Update password'}</button></form>{notice && <p className="notice">{notice}</p>}</section></div> }
// "Dr. R. Indhumathi", "DR.INDHUMATHI", and "DR INDHUMATHI" are the same person:
// strip the Dr prefix, punctuation, single-letter initials, and credential suffixes.
function doctorKey(name: string) {
  const tokens = name.toLowerCase().replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean)
  const CREDENTIALS = new Set(['dr', 'md', 'mbbs', 'ms', 'dnb', 'do', 'dm', 'phd', 'frcs', 'mch'])
  return tokens.filter((t) => !CREDENTIALS.has(t) && t.length > 1).join(' ')
}

function VisitPage({ events }: { events: MedicalEvent[] }) {
  const visits = events.filter((event) => event.event_type === 'appointment' || event.event_type === 'consultation' || event.event_type === 'procedure').sort((a, b) => {
    if (!a.event_date) return 1
    if (!b.event_date) return -1
    return b.event_date.localeCompare(a.event_date)
  })
  const byDoctor = new Map<string, { display: string; count: number }>()
  for (const visit of visits) {
    const name = visit.doctor_name || visit.facility || 'Doctor not recorded'
    const key = doctorKey(name) || name.toLowerCase()
    const existing = byDoctor.get(key)
    // Prefer the longest variant as the display name — it usually carries initials/casing.
    if (existing) byDoctor.set(key, { display: name.length > existing.display.length ? name : existing.display, count: existing.count + 1 })
    else byDoctor.set(key, { display: name, count: 1 })
  }
  return <Page title="Doctors & visits" eyebrow="CARE TIMELINE"><div className="content-grid"><section className="panel"><div className="panel-head"><div><p className="eyebrow">VISIT SUMMARY</p><h3>Who was visited</h3></div><strong>{visits.length}</strong></div>{byDoctor.size ? [...byDoctor.values()].sort((a, b) => b.count - a.count).map(({ display, count }) => <div className="data-row" key={display}><strong>{display}</strong><span>{count} visit{count === 1 ? '' : 's'}</span></div>) : <Empty text="Doctor visits and facilities will appear here when the records contain them." />}</section><section className="panel"><div className="panel-head"><div><p className="eyebrow">CHRONOLOGICAL VIEW</p><h3>Visits and procedures</h3></div></div>{visits.length ? <div className="timeline-list">{visits.map((event) => <div className="timeline-item" key={event.id}><span className="timeline-date">{event.event_date ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString() : 'Date unknown'}</span><div><strong>{event.doctor_name || event.title}</strong><span>{[event.specialty, event.facility, event.visit_reason || event.summary].filter(Boolean).join(' · ') || event.event_type}</span><small>Source page {event.source_page ?? '—'}</small></div></div>)}</div> : <Empty text="No dated visits or procedures extracted yet." />}</section></div></Page>
}
interface MedicineGroup { rep: Medication; ids: string[]; count: number }

function groupMedicines(medicines: Medication[]): MedicineGroup[] {
  const groups = new Map<string, MedicineGroup>()
  for (const med of medicines) {
    const key = [med.brand_name, med.generic_name, med.strength, med.dosage_form]
      .map((part) => (part ?? '').trim().toLowerCase())
      .join('|')
    const existing = groups.get(key)
    if (existing) groups.set(key, { ...existing, ids: [...existing.ids, med.id], count: existing.count + 1 })
    else groups.set(key, { rep: med, ids: [med.id], count: 1 })
  }
  return [...groups.values()]
}

function MedicinesPage({ medicines, onAdd, onEdit, onDelete }: { medicines: Medication[]; onAdd: (brand: string, generic: string, strength: string, form: string) => Promise<void>; onEdit: (ids: string[], brand: string, generic: string, strength: string, form: string) => Promise<void>; onDelete: (ids: string[]) => Promise<void> }) {
  const groups = groupMedicines(medicines)
  const [adding, setAdding] = useState(false)
  const [newBrand, setNewBrand] = useState('')
  const [newGeneric, setNewGeneric] = useState('')
  const [newStrength, setNewStrength] = useState('')
  const [newForm, setNewForm] = useState('')
  const [savingNew, setSavingNew] = useState(false)
  return (
    <Page title="Medicines" eyebrow="MEDICATION HISTORY">
      <div className="panel full-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">EXTRACTED MEDICINES</p>
            <h3>Prescribed or mentioned</h3>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span className="muted">{groups.length} medicine{groups.length === 1 ? '' : 's'}{groups.length !== medicines.length ? ` · ${medicines.length} mentions` : ''}</span>
            <button type="button" className="secondary small" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 10px', fontSize: '13px' }} onClick={() => setAdding((current) => !current)}>
              <Plus size={14} /> Add medicine
            </button>
          </div>
        </div>
        {adding && (
          <div className="data-row editing-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
            <div className="medicine-edit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input placeholder="Brand name (e.g. Istamet)" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} autoFocus />
              <input placeholder="Generic name (e.g. Metformin)" value={newGeneric} onChange={(e) => setNewGeneric(e.target.value)} />
              <input placeholder="Strength (e.g. 50/500mg)" value={newStrength} onChange={(e) => setNewStrength(e.target.value)} />
              <input placeholder="Form (e.g. tablet)" value={newForm} onChange={(e) => setNewForm(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="secondary small" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="primary small" disabled={savingNew || (!newBrand.trim() && !newGeneric.trim())} onClick={async () => { setSavingNew(true); await onAdd(newBrand, newGeneric, newStrength, newForm); setSavingNew(false); setAdding(false); setNewBrand(''); setNewGeneric(''); setNewStrength(''); setNewForm('') }}>{savingNew ? 'Adding…' : 'Add medicine'}</button>
            </div>
          </div>
        )}
        {groups.length ? (
          groups.map((group) => (
            <MedicineRow key={group.ids[0]} group={group} onEdit={onEdit} onDelete={onDelete} />
          ))
        ) : (
          <Empty text="Medicines will appear here when the extraction pipeline finds them." />
        )}
      </div>
    </Page>
  )
}

function MedicineRow({ group, onEdit, onDelete }: { group: MedicineGroup; onEdit: (ids: string[], brand: string, generic: string, strength: string, form: string) => Promise<void>; onDelete: (ids: string[]) => Promise<void> }) {
  const med = group.rep
  const [editing, setEditing] = useState(false)
  const [brand, setBrand] = useState(med.brand_name || '')
  const [generic, setGeneric] = useState(med.generic_name || '')
  const [strength, setStrength] = useState(med.strength || '')
  const [form, setForm] = useState(med.dosage_form || '')
  const [saving, setSaving] = useState(false)

  if (editing) {
    return (
      <div className="data-row editing-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
        <div className="medicine-edit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <input placeholder="Brand Name (e.g. Istamet)" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <input placeholder="Generic Name (e.g. Metformin)" value={generic} onChange={(e) => setGeneric(e.target.value)} />
          <input placeholder="Strength (e.g. 50/500mg)" value={strength} onChange={(e) => setStrength(e.target.value)} />
          <input placeholder="Form (e.g. tablet)" value={form} onChange={(e) => setForm(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button type="button" className="secondary small" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="primary small" disabled={saving} onClick={async () => { setSaving(true); await onEdit(group.ids, brand, generic, strength, form); setSaving(false); setEditing(false) }}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="data-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
      <div className="medicine-info" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <strong className="medicine-title" style={{ fontSize: '15px', color: '#1a2e26', fontWeight: 600 }}>
            {med.brand_name || med.generic_name || 'Unnamed medicine'}
          </strong>
          {med.generic_name && med.brand_name && med.generic_name.toLowerCase() !== med.brand_name.toLowerCase() && (
            <span style={{ fontSize: '13px', color: '#62776c', fontWeight: 400 }}>
              ({med.generic_name})
            </span>
          )}
        </div>
        <div style={{ fontSize: '13px', color: '#62776c', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{[med.strength, med.dosage_form, med.route].filter(Boolean).join(' · ') || 'Details pending'}</span>
          {group.count > 1 && <span className="mention-badge" style={{ background: '#eef6ef', border: '1px solid #cfe4d4', borderRadius: '999px', padding: '1px 8px', fontSize: '12px', color: '#3c6350' }}>{group.count} prescriptions</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <button type="button" className="retry-button" onClick={() => setEditing(true)} title="Edit medicine details" aria-label="Edit medicine"><Pencil size={14} /></button>
        <button type="button" className="delete-button" onClick={() => onDelete(group.ids)} title="Delete medicine" aria-label="Delete medicine"><Trash2 size={14} /></button>
      </div>
    </div>
  )
}

function Page({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) { return <section className="page"><div className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{title === 'Document library' ? 'Review upload status and source files.' : 'Everything extracted from the selected patient profile.'}</p></div>{children}</section> }
function Empty({ text }: { text: string }) { return <div className="empty"><FileText size={23} /><strong>Nothing here yet</strong><span>{text}</span></div> }
function testKey(name: string) { return name.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/\s+in\s+.*/g, '').replace(/[^a-z0-9]+/g, ' ').trim() }
function patientAge(dob?: string | null) { if (!dob) return null; const birth = new Date(dob); const now = new Date(); let age = now.getFullYear() - birth.getFullYear(); if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age--; return age }

function formatDateLabel(dateStr: string) {
  if (!dateStr) return '—'
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-').map(Number)
  if (year && month && day) {
    const d = new Date(year, month - 1, day)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
  }
  return dateStr
}

function generalRange(name: string, unit: string | null, age: number | null, sex?: string | null): [number, number] | null {
  const key = testKey(name); const u = (unit ?? '').toLowerCase();
  if ((key.includes('glucose') || key === 'fbs') && (u.includes('mg/dl') || !u)) return [70, 99]
  if (key === 'ppbs' && (u.includes('mg/dl') || !u)) return [70, 140]
  if (key.includes('hba1c')) return [4.0, 5.7]
  if (key.includes('systolic') || key === 'blood pressure') return [90, 120]
  if (key.includes('diastolic')) return [60, 80]
  if (key.includes('esr') || key.includes('erythrocyte sedimentation')) return [0, 20]
  if (key.includes('leucocyte') || key.includes('wbc') || key.includes('leukocyte')) return [4000, 11000]
  if (key.includes('platelet')) return u.includes('10') ? [150, 450] : [150000, 450000]
  if (key === 'creatinine' && u.includes('mg/dl')) return sex === 'female' ? [0.5, 1.1] : [0.7, 1.3]
  if (key === 'sodium') return [135, 145]
  if (key === 'potassium') return [3.5, 5.1]
  if (key === 'calcium') return [8.5, 10.5]
  if ((key.includes('hemoglobin') || key === 'hb') && !key.includes('hba1c')) return sex === 'female' ? [12, 16] : [13.5, 17.5]
  if (key === 'hematocrit') return sex === 'female' ? [36, 46] : [41, 53]
  if (key.includes('triglyceride') || key === 'tgl') return [50, 150]
  if (key.includes('cholesterol') && !key.includes('hdl') && !key.includes('ldl')) return [125, 200]
  if (key.includes('hdl') && !key.includes('non')) return [40, 60]
  if (key.includes('ldl') && !key.includes('vldl')) return [50, 100]
  return null
}

function VitalsPage({ labs, vitals, patient }: { labs: LabResult[]; vitals: Vital[]; patient?: PatientProfile }) {
  const systolicKeys = new Set(vitals.filter((v) => testKey(v.vital_type) === 'systolic blood pressure').map((v) => `${v.measured_at?.split('T')[0] ?? ''}|${v.value}`))
  const displayVitals = vitals.filter((v) => testKey(v.vital_type) !== 'blood pressure' || !systolicKeys.has(`${v.measured_at?.split('T')[0] ?? ''}|${v.value}`))
  const groups = new Map<string, { name: string; unit: string | null; points: Array<{ date: string; value: number }> }>()
  
  for (const lab of labs) {
    if (lab.numeric_value != null && Number.isFinite(Number(lab.numeric_value))) {
      const name = lab.test_name_normalized || lab.test_name_raw
      const key = testKey(name)
      const current = groups.get(key) ?? { name, unit: lab.unit, points: [] }
      if (lab.measured_at) {
        current.points.push({ date: lab.measured_at, value: Number(lab.numeric_value) })
      }
      groups.set(key, current)
    }
  }

  for (const vital of displayVitals) {
    if (vital.value != null && Number.isFinite(Number(vital.value)) && Number(vital.value) > 0) {
      const rawName = vital.vital_type
      const rawKey = testKey(rawName)
      // The extractor stores the original BP plus a normalized systolic row.
      // Treat them as one series so the chart does not show a duplicate trend.
      const name = rawKey === 'blood pressure' ? 'Systolic Blood Pressure' : rawName
      const key = testKey(name)
      const current = groups.get(key) ?? { name, unit: vital.unit, points: [] }
      if (vital.measured_at) {
        current.points.push({ date: vital.measured_at, value: Number(vital.value) })
      }
      groups.set(key, current)
    }
  }

  // Deduplicate identical date-value pairs and sort chronologically by parsed Date timestamp
  for (const group of groups.values()) {
    const seen = new Set<string>()
    group.points = group.points.filter((pt) => {
      const k = `${pt.date.split('T')[0]}|${pt.value}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }

  const trends = [...groups.values()].filter((group) => group.points.length > 1).sort((a, b) => a.name.localeCompare(b.name))
  const age = patientAge(patient?.date_of_birth)

  // Pair systolic + diastolic readings taken together into a single "120/80" row.
  const diastolicByKey = new Map<string, Vital>()
  for (const v of displayVitals) {
    if (testKey(v.vital_type) === 'diastolic blood pressure') diastolicByKey.set(`${v.measured_at?.split('T')[0] ?? ''}|${v.source_page ?? ''}`, v)
  }
  const pairedDiastolicIds = new Set<string>()
  const systolicPairs = new Map<string, Vital>()
  for (const v of displayVitals) {
    if (testKey(v.vital_type) !== 'systolic blood pressure') continue
    const dia = diastolicByKey.get(`${v.measured_at?.split('T')[0] ?? ''}|${v.source_page ?? ''}`)
    if (dia && !pairedDiastolicIds.has(dia.id)) { pairedDiastolicIds.add(dia.id); systolicPairs.set(v.id, dia) }
  }
  // One row per vital type, showing the most recent reading (rows arrive newest-first).
  const vitalLatest = new Map<string, { id: string; label: string; date: string | null; count: number }>()
  for (const v of displayVitals) {
    if (pairedDiastolicIds.has(v.id)) continue
    const dia = systolicPairs.get(v.id)
    const typeKey = dia ? 'blood pressure' : testKey(v.vital_type)
    const existing = vitalLatest.get(typeKey)
    if (existing) { existing.count += 1; continue }
    const label = dia
      ? `Blood pressure: ${v.value}/${dia.value} ${v.unit ?? 'mmHg'}`
      : `${v.vital_type}: ${v.value} ${v.unit ?? ''}`.trim()
    vitalLatest.set(typeKey, { id: v.id, label, date: v.measured_at, count: 1 })
  }
  const vitalRows = [...vitalLatest.values()]
  const totalVitalReadings = displayVitals.length - pairedDiastolicIds.size

  // One row per lab test, most recent value first (query returns newest-first).
  const labLatest = new Map<string, { lab: LabResult; count: number }>()
  for (const lab of labs) {
    const key = testKey(lab.test_name_normalized || lab.test_name_raw)
    const existing = labLatest.get(key)
    if (existing) existing.count += 1
    else labLatest.set(key, { lab, count: 1 })
  }
  const labRows = [...labLatest.values()]

  return (
    <Page title="Vitals & labs" eyebrow="STRUCTURED HISTORY">
      <div className="reference-note">
        Reference bands are general adult guides, not diagnoses. Prefer the range printed on the original report; age-specific ranges require a recorded date of birth.
      </div>
      {trends.length > 0 && (
        <section className="trend-grid">
          {trends.map((trend) => (
            <TrendChart key={`${trend.name}-${trend.unit}`} trend={trend} age={age} sex={patient?.biological_sex} />
          ))}
        </section>
      )}
      {trends.length > 0 && <p className="trend-summary">Showing {trends.length} repeated measurements with dated numeric values. Tests with only one recorded value remain in the lists below and are not treated as trends.</p>}
      <div className="content-grid structured-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">VITALS</p>
              <h3>Measurements</h3>
            </div>
            <strong>{vitalRows.length}</strong>
          </div>
          {vitalRows.length ? (
            <>
              <p className="latest-note">Latest reading per vital · {totalVitalReadings} total readings. Repeated vitals are charted above.</p>
              {vitalRows.map((row) => (
                <div className="data-row" key={row.id}>
                  <strong>{row.label}</strong>
                  <span>{row.date ? formatDateLabel(row.date) : 'Date not recorded'}{row.count > 1 ? ` · ${row.count} readings` : ''}</span>
                </div>
              ))}
            </>
          ) : (
            <Empty text="No vitals extracted yet." />
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">LAB RESULTS</p>
              <h3>Latest values</h3>
            </div>
            <strong>{labRows.length}</strong>
          </div>
          {labRows.length ? (
            <div className="lab-list">
              <p className="latest-note">Latest value per test · {labs.length} total readings. Tests with repeat readings are charted above.</p>
              {labRows.map(({ lab, count }) => (
                <div className="data-row" key={lab.id} style={{ padding: '8px 0' }}>
                  <strong>{lab.test_name_raw}: {lab.value_text ?? lab.numeric_value ?? '—'} {lab.unit ?? ''} {lab.reference_range ? `(doc range: ${lab.reference_range})` : ''}</strong>
                  <span>{lab.measured_at ? formatDateLabel(lab.measured_at) : 'Date not recorded'}{count > 1 ? ` · ${count} readings` : ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No blood test reports found in uploaded documents." />
          )}
        </div>
      </div>
    </Page>
  )
}

function TrendChart({ trend, age, sex }: { trend: { name: string; unit: string | null; points: { date: string; value: number }[] }; age: number | null; sex?: string | null }) {
  const points = [...trend.points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const range = generalRange(trend.name, trend.unit, age, sex)
  const values = points.map((point) => point.value)
  const min = Math.min(...values, ...(range ? [range[0]] : []))
  const max = Math.max(...values, ...(range ? [range[1]] : []))
  const padding = Math.max((max - min) * 0.2, 0.5)
  const low = min - padding
  const high = max + padding

  // Time-proportional x-axis so gaps between visits read truthfully.
  // Falls back to even spacing when all points share (nearly) the same date.
  const t0 = new Date(points[0].date).getTime()
  const t1 = new Date(points[points.length - 1].date).getTime()
  const span = t1 - t0
  const DAY = 86400000
  const x = (index: number) => {
    if (span < DAY) return 54 + (index * 530) / Math.max(points.length - 1, 1)
    return 54 + ((new Date(points[index].date).getTime() - t0) / span) * 530
  }
  const y = (value: number) => 195 - ((value - low) / (high - low || 1)) * 145
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')

  // Only label dates that have breathing room, but always keep first and last.
  const MIN_LABEL_GAP = 88
  const labelledIndexes = new Set<number>()
  let lastLabelX = -Infinity
  points.forEach((_, index) => {
    const px = x(index)
    const lastX = x(points.length - 1)
    if (index === points.length - 1 || (px - lastLabelX >= MIN_LABEL_GAP && lastX - px >= MIN_LABEL_GAP)) {
      labelledIndexes.add(index)
      lastLabelX = px
    }
  })

  // Value labels: all when sparse, otherwise just first, last, min, and max.
  const showAllValues = points.length <= 7
  const minIndex = values.indexOf(Math.min(...values))
  const maxIndex = values.indexOf(Math.max(...values))
  const valueIndexes = new Set(showAllValues ? points.map((_, i) => i) : [0, points.length - 1, minIndex, maxIndex])

  const latest = points[points.length - 1]
  const gridValues = [low + (high - low) * 0.25, low + (high - low) * 0.5, low + (high - low) * 0.75]
  const formatGrid = (value: number) => Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '')

  return (
    <article className="panel trend-card">
      <div className="panel-head">
        <div>
          <p className="eyebrow">TREND</p>
          <h3>{trend.name}</h3>
        </div>
        <span className="trend-latest">{latest.value} {trend.unit ?? ''}<small>{formatDateLabel(latest.date)}</small></span>
      </div>
      <svg viewBox="0 0 640 240" role="img" aria-label={`${trend.name} over time`} className="trend-svg">
        {gridValues.map((value) => (
          <g key={value}>
            <line x1="48" y1={y(value)} x2="608" y2={y(value)} className="chart-grid" />
            <text x="44" y={y(value) + 4} textAnchor="end" className="chart-grid-label">{formatGrid(value)}</text>
          </g>
        ))}
        <line x1="48" y1="205" x2="608" y2="205" className="chart-axis" />
        {range && (
          <>
            <rect x="48" y={Math.max(y(range[1]), 15)} width="560" height={Math.max(Math.abs(y(range[0]) - y(range[1])), 2)} className="reference-band" />
            <text x="52" y={Math.max(y(range[1]) - 6, 22)} className="chart-label">general range {range[0]}–{range[1]}</text>
          </>
        )}
        <polyline points={line} className="trend-line" />
        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle cx={x(index)} cy={y(point.value)} r="4.5" className="trend-dot" />
            {valueIndexes.has(index) && (
              <text x={x(index)} y={Math.max(y(point.value) - 11, 20)} textAnchor="middle" style={{ fontSize: '17px', fontWeight: 700, fill: '#1a2e26' }}>
                {point.value}
              </text>
            )}
            {labelledIndexes.has(index) && (
              <text x={x(index)} y="228" textAnchor="middle" className="chart-label chart-date-label">
                {formatDateLabel(point.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </article>
  )
}
function AskArchivePage({ question, setQuestion, asking, answer, citations, documents, onAsk, onOpenSource }: { question: string; setQuestion: (value: string) => void; asking: boolean; answer: string; citations: Array<{ document_id: string; page_start: number | null; page_end: number | null }>; documents: DocumentRecord[]; onAsk: (event: React.FormEvent) => void; onOpenSource: (documentId: string, page?: number | null) => void }) {
  const suggestions = ['What changed recently?', 'Show repeated lab values', 'What medicines are mentioned?']
  return <Page title="Ask the archive" eyebrow="CITED SEARCH"><div className="panel full-panel ask-panel"><div className="ask-heading"><div className="ask-icon"><Search size={24} /></div><div><h3>Search across this patient’s records</h3><p className="muted">Answers use indexed records, source pages, and only the selected patient’s data.</p></div></div><div className="suggestion-row">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="suggestion" onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}</div><form className="ask-placeholder" onSubmit={onAsk}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about labs, medicines, dates, or changes…" disabled={asking} /><button className="primary" type="submit" disabled={asking || !question.trim()}>{asking ? <><LoaderCircle className="spin" size={15} /> Searching</> : <><Search size={15} /> Search archive</>}</button></form>{answer ? <div className="answer-box"><div className="answer-title"><strong>Archive answer</strong><span>Source-grounded</span></div><p>{answer}</p>{citations.length > 0 && <div className="citation-list"><strong>Sources</strong>{citations.map((citation, index) => { const doc = documents.find((d) => d.id === citation.document_id); const p = citation.page_start ?? 1; return <button type="button" className="citation-link" key={`${citation.document_id}-${index}`} onClick={() => onOpenSource(citation.document_id, p)}><span>{doc?.original_filename || `Document ${citation.document_id.slice(0, 8)}`}</span><small>Page {p} · Open source PDF ↗</small></button> })}</div>}</div> : <div className="ask-empty"><Search size={20} /><span>Ask a question to compare records, find dates, or trace repeated measurements.</span></div>}</div></Page>
}
function Overview({ patient, documents, vitals, events, processingLabel, processingIcon, navigate }: { patient?: PatientProfile; documents: DocumentRecord[]; vitals: Vital[]; events: MedicalEvent[]; processingLabel: (s: string) => string; processingIcon: (s: string) => React.ReactNode; navigate: (s: string) => void }) {
  return (
    <section className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">{patient?.display_name ?? 'WELCOME'}</p>
          <h1>The clearest picture of care, over time.</h1>
          <p className="muted">Upload historical records and turn scattered pages into a cited, searchable timeline.</p>
        </div>
        <div className="hero-orb"><HeartPulse size={38} /></div>
      </section>
      <div className="stat-grid">
        <article className="stat-card">
          <div className="stat-icon blue"><FileText size={18} /></div>
          <span>Documents</span>
          <strong>{documents.length}</strong>
          <small>Uploaded to this profile</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon green"><Activity size={18} /></div>
          <span>Vitals captured</span>
          <strong>{vitals.length}</strong>
          <small>With source references</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon amber"><HeartPulse size={18} /></div>
          <span>Processing</span>
          <strong>{documents.filter((d) => !['indexed', 'validated'].includes(d.processing_status)).length}</strong>
          <small>Automatic backend queue</small>
        </article>
      </div>
      <section className="content-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">RECENT RECORDS</p>
              <h3>Document library</h3>
            </div>
            <button className="icon-button" onClick={() => navigate('Documents')} aria-label="Open documents"><Search size={17} /></button>
          </div>
          {documents.length ? (
            <div className="document-list">
              {documents.slice(0, 6).map((doc) => (
                <div className="document-row" key={doc.id}>
                  <div className="file-icon"><FileText size={17} /></div>
                  <div className="document-name">
                    <strong>{doc.original_filename}</strong>
                    <span>{doc.document_type || (doc.processing_status === 'indexed' ? 'Prescription / Medical record' : 'Processing document')}</span>
                  </div>
                  <span className={`status ${doc.processing_status}`}>
                    {processingIcon(doc.processing_status)} {processingLabel(doc.processing_status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Upload a PDF or a clear photo of a medical page." />
          )}
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">CARE TIMELINE</p>
              <h3>Doctors and visits</h3>
            </div>
            <span className="muted">{events.length} event{events.length === 1 ? '' : 's'}</span>
          </div>
          {events.length ? (
            <div className="timeline-list">
              {[...events].sort((a, b) => { if (!a.event_date) return 1; if (!b.event_date) return -1; return b.event_date.localeCompare(a.event_date) }).slice(0, 8).map((event) => (
                <div className="timeline-item" key={event.id}>
                  <span className="timeline-date">{event.event_date ? new Date(`${event.event_date}T00:00:00`).toLocaleDateString() : 'Date unknown'}</span>
                  <div>
                    <strong>{event.doctor_name || event.title}</strong>
                    <span>{[event.specialty, event.facility, event.visit_reason || event.summary].filter(Boolean).join(' · ') || event.event_type}</span>
                    <small>Source page {event.source_page ?? '—'}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Doctors, facilities, visits, and procedures will appear here after extraction." />
          )}
        </article>
      </section>
    </section>
  )
}

export default App
