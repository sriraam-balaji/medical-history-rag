import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const auth = request.headers.get('Authorization')
  if (!auth) return json({ error: 'Authentication required' }, 401)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: userData } = await userClient.auth.getUser()
  if (!userData.user) return json({ error: 'Invalid session' }, 401)

  const { data: documents, error } = await userClient.from('documents').select('id, patient_id, original_filename, storage_path').eq('processing_status', 'queued').limit(50)
  if (error) return json({ error: error.message }, 500)
  if (!documents?.length) return json({ message: 'No queued documents', count: 0 })

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY is not configured' }, 503)

  const lines: string[] = []
  for (const document of documents) {
    const { data: signed } = await service.storage.from('medical-documents').createSignedUrl(document.storage_path, 3600)
    if (!signed?.signedUrl) continue
    lines.push(JSON.stringify({
      key: document.id,
      request: {
        contents: [{ parts: [
          { file_data: { mime_type: 'application/pdf', file_uri: signed.signedUrl } },
          { text: 'Extract this historical medical document into the required JSON shape. Preserve exact dates, values, units, medicine instructions, uncertainty, and page references. Never infer missing facts. Distinguish prescribed, reported_taking, stopped, changed, completed, and unknown. Return JSON only.' },
        ] }],
        generation_config: { response_mime_type: 'application/json' },
      },
    }))
  }
  if (!lines.length) return json({ error: 'Could not create document URLs' }, 500)

  // The production implementation should upload this JSONL file to Gemini Files API,
  // then call batches.create with the uploaded JSONL resource. Keeping the request
  // construction here makes the retry/idempotency boundary explicit.
  const body = new Blob([lines.join('\n')], { type: 'application/jsonl' })
  const form = new FormData()
  form.append('file', body, 'medical-batch.jsonl')
  form.append('metadata', JSON.stringify({ display_name: `medical-batch-${Date.now()}`, mime_type: 'application/jsonl' }))
  const upload = await fetch(`${GEMINI}/files?key=${geminiKey}`, { method: 'POST', body: form })
  if (!upload.ok) return json({ error: `Gemini file upload failed: ${await upload.text()}` }, 502)
  const uploaded = await upload.json()

  const batch = await fetch(`${GEMINI}/batches?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'models/gemini-3.5-flash', src: uploaded.name, config: { display_name: `medical-batch-${Date.now()}` } }) })
  if (!batch.ok) return json({ error: `Gemini batch creation failed: ${await batch.text()}` }, 502)
  const batchData = await batch.json()
  await service.from('documents').update({ processing_status: 'batch_submitted', batch_job_id: batchData.name }).in('id', documents.map((d) => d.id))
  for (const document of documents) await service.from('extraction_jobs').insert({ document_id: document.id, status: 'batch_submitted', gemini_batch_id: batchData.name, model_version: 'gemini-3.5-flash', prompt_version: 'v1', schema_version: 'v1' })
  return json({ batch_id: batchData.name, count: documents.length })
})
