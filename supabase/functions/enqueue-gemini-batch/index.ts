import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const MODEL = 'gemini-3.1-flash-lite'
const PROMPT = `Classify and extract this historical document into JSON. This archive accepts medical records only. Set content_classification to exactly one of medical_document, non_medical, or uncertain. A medical_document must contain patient-care information such as a clinical report, prescription, lab result, imaging report, discharge summary, consultation note, vaccination record, medical bill, or hospital document. Do not classify a document as medical merely because it contains a person or date. For medical_document, extract exact dates, values, units, medicine instructions, uncertainty, and page references. Never infer missing facts. Distinguish prescribed, reported_taking, stopped, changed, completed, and unknown. Extract visits or appointments with doctor_name, specialty, facility, visit_reason, date, type, and page. Return JSON only.`
const EMBEDDING_MODEL = 'gemini-embedding-2'
const ENABLE_BATCH_API = Deno.env.get('ENABLE_GEMINI_BATCH') === 'true'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function requireDb<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`)
  return result.data
}

function mimeTypeFor(filename: string): string {
  const name = filename.toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.heic')) return 'image/heic'
  return 'image/jpeg'
}

async function recordFailure(service: ReturnType<typeof createClient>, documentId: string, message: string) {
  await service.from('extraction_jobs').insert({ document_id: documentId, status: 'failed_retryable', prompt_version: 'v1-fallback', schema_version: 'v1', error_message: message })
  await service.from('documents').update({ processing_status: 'failed_retryable' }).eq('id', documentId)
}

async function uploadGeminiFile(bytes: Uint8Array, mimeType: string, displayName: string, apiKey: string) {
  const start = await fetch(`${GEMINI_UPLOAD}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  })
  if (!start.ok) throw new Error(`Gemini file start failed: ${await start.text()}`)
  const uploadUrl = start.headers.get('x-goog-upload-url') ?? start.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) throw new Error('Gemini did not return an upload URL')
  const finish = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(bytes.byteLength), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytes,
  })
  if (!finish.ok) throw new Error(`Gemini file upload failed: ${await finish.text()}`)
  const result = await finish.json()
  return { uri: result.file?.uri as string, name: result.file?.name as string }
}

async function runNormalFallback(fileUri: string, mimeType: string, apiKey: string) {
  const response = await fetch(`${GEMINI}/models/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { file_data: { mime_type: mimeType, file_uri: fileUri } }] }], generation_config: { response_mime_type: 'application/json' } }),
  })
  if (!response.ok) throw new Error(`Normal Gemini request failed: ${await response.text()}`)
  const output = await response.json()
  const text = output.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? ''
  let validated: unknown
  try { validated = JSON.parse(text) } catch { validated = { raw_text: text, parse_warning: 'Model output was not valid JSON' } }
  return { output, validated }
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  return {}
}

function asArray(value: unknown): any[] { return Array.isArray(value) ? value : [] }

function contentClassification(value: unknown): string {
  const root = asObject(value)
  return String(root.content_classification ?? root.document_classification ?? root.classification ?? '').toLowerCase()
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? null
}

function dateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function embedText(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch(`${GEMINI}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text }] }, output_dimensionality: 768 }),
  })
  if (!response.ok) throw new Error(`Embedding request failed: ${await response.text()}`)
  const result = await response.json()
  const values = result.embeddings?.[0]?.values ?? result.embedding?.values
  if (!Array.isArray(values) || values.length !== 768) throw new Error(`Unexpected embedding dimensions: ${values?.length ?? 0}`)
  return values
}

async function indexExtraction(service: ReturnType<typeof createClient>, document: any, extracted: unknown, apiKey: string) {
  const root = asObject(extracted)
  const patient = asObject(root.patient)
  const labs: any[] = []
  for (const report of asArray(patient.laboratory_reports ?? root.laboratory_reports ?? root.lab_results)) {
    for (const result of asArray(report.results ?? report.tests)) labs.push({
      patient_id: document.patient_id, test_name_raw: String(result.test ?? result.name ?? 'Unknown test'), test_name_normalized: result.normalized_name ?? null,
      value_text: result.value == null ? null : String(result.value), numeric_value: typeof result.value === 'number' ? result.value : Number(result.value) || null,
      unit: result.unit ?? null, reference_range: result.reference_range ?? null, measured_at: dateTime(report.date ?? result.date), source_document_id: document.id, source_page: report.page ?? result.page ?? null, evidence: JSON.stringify(result), confidence: 0.85,
    })
  }
  const vitals = asArray(patient.vitals ?? root.vitals).flatMap((v) => {
    const value = typeof v.value === 'number' ? v.value : Number(v.value)
    return Number.isFinite(value) ? [{ patient_id: document.patient_id, vital_type: String(v.type ?? v.name ?? 'Vital'), value, unit: v.unit ?? null, measured_at: dateTime(v.date ?? v.measured_at), source_document_id: document.id, source_page: v.page ?? null, evidence: JSON.stringify(v), confidence: 0.8 }] : []
  })
  const medications = asArray(patient.medications ?? root.medications ?? root.medicines).map((m) => ({ patient_id: document.patient_id, brand_name: m.brand_name ?? m.name ?? null, generic_name: m.generic_name ?? m.ingredient ?? null, strength: m.strength ?? m.dose ?? null, dosage_form: m.dosage_form ?? null, route: m.route ?? null, manufacturer: m.manufacturer ?? null, composition_status: m.composition_status ?? 'unknown', source_document_id: document.id, source_page: m.page ?? null, confidence: 0.8 }))
  const visits = asArray(patient.visits ?? root.visits ?? patient.appointments ?? root.appointments)
  const events = [...visits.map((e) => ({ event_date: dateOnly(e.date ?? e.visit_date), event_type: 'appointment', title: String(e.type ?? e.visit_type ?? 'Appointment'), summary: e.reason ?? e.visit_reason ?? null, doctor_name: e.doctor_name ?? e.doctor ?? e.physician ?? null, specialty: e.specialty ?? e.department ?? null, facility: e.facility ?? e.hospital ?? e.clinic ?? null, visit_reason: e.reason ?? e.visit_reason ?? null, source_page: e.page ?? null, evidence: JSON.stringify(e) })), ...asArray(patient.procedures ?? root.procedures).map((e) => ({ event_date: dateOnly(e.date), event_type: 'procedure', title: String(e.name ?? 'Procedure'), summary: e.status ?? null, doctor_name: e.doctor_name ?? e.doctor ?? null, specialty: e.specialty ?? null, facility: e.facility ?? e.hospital ?? null, visit_reason: null, source_page: e.page ?? null, evidence: JSON.stringify(e) }))].map((e) => ({ ...e, patient_id: document.patient_id, source_document_id: document.id, confidence: 0.85 }))

  for (const table of ['medical_events', 'medications', 'vitals', 'lab_results']) requireDb(await service.from(table).delete().eq('source_document_id', document.id), `Clear ${table}`)
  if (events.length) requireDb(await service.from('medical_events').insert(events), 'Insert medical events')
  if (medications.length) requireDb(await service.from('medications').insert(medications), 'Insert medications')
  if (vitals.length) requireDb(await service.from('vitals').insert(vitals), 'Insert vitals')
  if (labs.length) requireDb(await service.from('lab_results').insert(labs), 'Insert lab results')

  const serialized = JSON.stringify(extracted)
  const chunks = serialized.match(/.{1,5000}/gs) ?? [serialized]
  requireDb(await service.from('document_chunks').delete().eq('document_id', document.id), 'Clear document chunks')
  for (let index = 0; index < chunks.length; index++) {
    const embedding = await embedText(chunks[index], apiKey)
    requireDb(await service.from('document_chunks').insert({ patient_id: document.patient_id, document_id: document.id, chunk_index: index, content: chunks[index], embedding: `[${embedding.join(',')}]`, metadata: { source: 'gemini-embedding-2', model_version: EMBEDDING_MODEL } }), 'Insert document chunk')
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const auth = request.headers.get('Authorization')
  if (!auth) return json({ error: 'Authentication required' }, 401)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: userData } = await userClient.auth.getUser()
  if (!userData.user) return json({ error: 'Invalid session' }, 401)

  const { data: documents, error } = await userClient.from('documents').select('id, patient_id, original_filename, storage_path').eq('processing_status', 'queued').limit(10)
  if (error) return json({ error: error.message }, 500)
  if (!documents?.length) return json({ message: 'No queued documents', count: 0 })
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY is not configured' }, 503)

  const uploadedFiles: Array<{ id: string; patient_id: string; storage_path: string; uri: string; mimeType: string }> = []
  for (const document of documents) {
    try {
      const claimed = await service.from('documents').update({ processing_status: 'processing' }).eq('id', document.id).eq('processing_status', 'queued').select('id').maybeSingle()
      if (claimed.error) throw new Error(`Claim document: ${claimed.error.message}`)
      if (!claimed.data) continue
      const { data: signed } = await service.storage.from('medical-documents').createSignedUrl(document.storage_path, 3600)
      if (!signed?.signedUrl) throw new Error('Could not create a signed URL for the stored file')
      const source = await fetch(signed.signedUrl)
      if (!source.ok) throw new Error(`Could not download stored file (${source.status})`)
      const bytes = new Uint8Array(await source.arrayBuffer())
      const mimeType = mimeTypeFor(document.original_filename)
      const uploaded = await uploadGeminiFile(bytes, mimeType, document.original_filename, geminiKey)
      uploadedFiles.push({ id: document.id, patient_id: document.patient_id, storage_path: document.storage_path, uri: uploaded.uri, mimeType })
    } catch (error) {
      await recordFailure(service, document.id, String(error))
    }
  }
  if (!uploadedFiles.length) return json({ error: 'Could not upload documents to Gemini' }, 502)

  let batch: Response
  if (ENABLE_BATCH_API) {
    const lines = uploadedFiles.map((file) => JSON.stringify({ key: file.id, request: { contents: [{ parts: [{ file_data: { mime_type: file.mimeType, file_uri: file.uri } }, { text: PROMPT }] }], generation_config: { response_mime_type: 'application/json' } } }))
    const batchInput = await uploadGeminiFile(new TextEncoder().encode(lines.join('\n')), 'application/jsonl', `medical-batch-${Date.now()}.jsonl`, geminiKey)
    batch = await fetch(`${GEMINI}/batches?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: `models/${MODEL}`, src: batchInput.name, config: { display_name: `medical-batch-${Date.now()}` } }) })
  } else {
    batch = new Response('Batch API disabled; using normal generation.', { status: 503 })
  }

  if (!batch.ok) {
    const reason = await batch.text()
    const fallbackResults = []
    for (const file of uploadedFiles) {
      let fallback: { output: unknown; validated: unknown } | null = null
      try {
        fallback = await runNormalFallback(file.uri, file.mimeType, geminiKey)
        const classification = contentClassification(fallback.validated)
        if (classification !== 'medical_document') throw new Error(`NonMedicalDocument: Gemini classified this upload as ${classification || 'uncertain'}. Only medical records are accepted.`)
        await indexExtraction(service, file, fallback.validated, geminiKey)
        await service.from('extraction_jobs').delete().eq('document_id', file.id)
        requireDb(await service.from('extraction_jobs').insert({ document_id: file.id, status: 'indexed', raw_output: fallback.output, validated_output: fallback.validated, model_version: MODEL, prompt_version: 'v1-fallback', schema_version: 'v1' }), 'Save extraction job')
        requireDb(await service.from('documents').update({ processing_status: 'indexed', content_classification: 'medical_document', rejection_reason: null, processed_at: new Date().toISOString() }).eq('id', file.id), 'Mark document indexed')
        fallbackResults.push({ id: file.id, status: 'indexed', embedding_model: EMBEDDING_MODEL })
      } catch (fallbackError) {
        const errorMessage = String(fallbackError)
        if (errorMessage.includes('NonMedicalDocument:')) {
          await service.storage.from('medical-documents').remove([file.storage_path])
          await service.from('documents').update({ processing_status: 'failed_permanent', content_classification: 'non_medical', rejection_reason: errorMessage.replace('Error: NonMedicalDocument: ', '') }).eq('id', file.id)
          await service.from('extraction_jobs').delete().eq('document_id', file.id)
          fallbackResults.push({ id: file.id, status: 'rejected_non_medical', error: errorMessage.replace('Error: NonMedicalDocument: ', '') })
        } else if (fallback) {
          await service.from('extraction_jobs').delete().eq('document_id', file.id)
          await service.from('extraction_jobs').insert({ document_id: file.id, status: 'validated', raw_output: fallback.output, validated_output: fallback.validated, model_version: MODEL, prompt_version: 'v1-fallback', schema_version: 'v1', error_message: errorMessage })
          await service.from('documents').update({ processing_status: 'validated', processed_at: new Date().toISOString() }).eq('id', file.id)
          fallbackResults.push({ id: file.id, status: 'validated', error: errorMessage })
        } else {
          await recordFailure(service, file.id, errorMessage)
          fallbackResults.push({ id: file.id, status: 'failed_retryable', error: errorMessage })
        }
      }
    }
    return json({ mode: 'normal_fallback', reason, results: fallbackResults })
  }

  const batchData = await batch.json()
  await service.from('documents').update({ processing_status: 'batch_submitted', batch_job_id: batchData.name }).in('id', uploadedFiles.map((file) => file.id))
  for (const file of uploadedFiles) await service.from('extraction_jobs').insert({ document_id: file.id, status: 'batch_submitted', gemini_batch_id: batchData.name, model_version: MODEL, prompt_version: 'v1', schema_version: 'v1' })
  return json({ mode: 'batch', batch_id: batchData.name, count: uploadedFiles.length })
})
