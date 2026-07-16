import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const API = 'https://generativelanguage.googleapis.com/v1beta'
const EMBEDDING_MODEL = 'gemini-embedding-2'
const ANSWER_MODEL = 'gemini-3.1-flash-lite'

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = request.headers.get('Authorization')
  if (!auth) return json({ error: 'Authentication required' }, 401)
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: userData } = await userClient.auth.getUser()
  if (!userData.user) return json({ error: 'Invalid session' }, 401)
  const body = await request.json().catch(() => null)
  const patientId = typeof body?.patient_id === 'string' ? body.patient_id : ''
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!patientId || !question) return json({ error: 'patient_id and question are required' }, 400)
  const { data: patient } = await userClient.from('patient_profiles').select('id, display_name').eq('id', patientId).maybeSingle()
  if (!patient) return json({ error: 'Patient profile not accessible' }, 403)
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'GEMINI_API_KEY is not configured' }, 503)

  const embeddingResponse = await fetch(`${API}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: question }] }, output_dimensionality: 768 }) })
  if (!embeddingResponse.ok) return json({ error: `Embedding request failed: ${await embeddingResponse.text()}` }, 502)
  const embeddingPayload = await embeddingResponse.json()
  const embedding = embeddingPayload.embeddings?.[0]?.values ?? embeddingPayload.embedding?.values
  if (!Array.isArray(embedding)) return json({ error: 'Embedding response was empty' }, 502)
  const { data: chunks, error: chunkError } = await userClient.rpc('match_document_chunks', { query_embedding: `[${embedding.join(',')}]`, match_patient_id: patientId, match_count: 8 })
  if (chunkError) return json({ error: `Retrieval failed: ${chunkError.message}` }, 500)
  const context = (chunks ?? []).map((chunk: { content: string; document_id: string; page_start: number | null; page_end: number | null; similarity: number }) => `[document ${chunk.document_id}, pages ${chunk.page_start ?? '?'}-${chunk.page_end ?? '?'}]\n${chunk.content}`).join('\n\n')
  if (!context) return json({ answer: 'I could not find indexed information for this patient yet.', citations: [] })
  const answerResponse = await fetch(`${API}/models/${ANSWER_MODEL}:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: `You answer questions about a private medical archive. Use only the supplied record context. Do not diagnose, infer, or give treatment instructions. If the context does not answer the question, say so. Cite source document IDs and page numbers in a Sources section. Patient: ${patient.display_name}\n\nQuestion: ${question}\n\nRecord context:\n${context}` }] }], generation_config: { temperature: 0.1 } }) })
  if (!answerResponse.ok) return json({ error: `Answer request failed: ${await answerResponse.text()}` }, 502)
  const answerPayload = await answerResponse.json()
  const answer = answerPayload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? 'No answer was returned.'
  return json({ answer, citations: (chunks ?? []).map((chunk: { document_id: string; page_start: number | null; page_end: number | null; similarity: number }) => ({ document_id: chunk.document_id, page_start: chunk.page_start, page_end: chunk.page_end, similarity: chunk.similarity })) })
})
