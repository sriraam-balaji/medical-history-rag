import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const MODEL = 'gemini-3.1-flash-lite'
const PROMPT = 'Extract this historical medical document into JSON. Preserve exact dates, values, units, medicine instructions, uncertainty, and page references. Never infer missing facts. Distinguish prescribed, reported_taking, stopped, changed, completed, and unknown. Return JSON only.'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
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

  const uploadedFiles: Array<{ id: string; uri: string; mimeType: string }> = []
  for (const document of documents) {
    const { data: signed } = await service.storage.from('medical-documents').createSignedUrl(document.storage_path, 3600)
    if (!signed?.signedUrl) continue
    const source = await fetch(signed.signedUrl)
    if (!source.ok) continue
    const bytes = new Uint8Array(await source.arrayBuffer())
    const mimeType = document.original_filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'
    const uploaded = await uploadGeminiFile(bytes, mimeType, document.original_filename, geminiKey)
    uploadedFiles.push({ id: document.id, uri: uploaded.uri, mimeType })
  }
  if (!uploadedFiles.length) return json({ error: 'Could not upload documents to Gemini' }, 502)

  const lines = uploadedFiles.map((file) => JSON.stringify({ key: file.id, request: { contents: [{ parts: [{ file_data: { mime_type: file.mimeType, file_uri: file.uri } }, { text: PROMPT }] }], generation_config: { response_mime_type: 'application/json' } } }))
  const batchInput = await uploadGeminiFile(new TextEncoder().encode(lines.join('\n')), 'application/jsonl', `medical-batch-${Date.now()}.jsonl`, geminiKey)
  const batch = await fetch(`${GEMINI}/batches?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: `models/${MODEL}`, src: batchInput.name, config: { display_name: `medical-batch-${Date.now()}` } }) })

  if (!batch.ok) {
    const reason = await batch.text()
    const fallbackResults = []
    for (const file of uploadedFiles) {
      try {
        const fallback = await runNormalFallback(file.uri, file.mimeType, geminiKey)
        await service.from('extraction_jobs').insert({ document_id: file.id, status: 'validated', raw_output: fallback.output, validated_output: fallback.validated, model_version: MODEL, prompt_version: 'v1-fallback', schema_version: 'v1' })
        await service.from('documents').update({ processing_status: 'validated', processed_at: new Date().toISOString() }).eq('id', file.id)
        fallbackResults.push({ id: file.id, status: 'validated' })
      } catch (fallbackError) {
        await service.from('documents').update({ processing_status: 'failed_retryable' }).eq('id', file.id)
        fallbackResults.push({ id: file.id, status: 'failed_retryable', error: String(fallbackError) })
      }
    }
    return json({ mode: 'normal_fallback', reason, results: fallbackResults })
  }

  const batchData = await batch.json()
  await service.from('documents').update({ processing_status: 'batch_submitted', batch_job_id: batchData.name }).in('id', uploadedFiles.map((file) => file.id))
  for (const file of uploadedFiles) await service.from('extraction_jobs').insert({ document_id: file.id, status: 'batch_submitted', gemini_batch_id: batchData.name, model_version: MODEL, prompt_version: 'v1', schema_version: 'v1' })
  return json({ mode: 'batch', batch_id: batchData.name, count: uploadedFiles.length })
})
