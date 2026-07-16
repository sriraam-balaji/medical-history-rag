// Backend placeholder for Gemini Batch webhook processing.
// Deploy with: supabase functions deploy process-gemini-webhook
// Configure GEMINI_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY as function secrets.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (request) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const payload = await request.json().catch(() => null)
  if (!payload?.type || !payload?.data?.id) return new Response('Invalid webhook', { status: 400 })

  // TODO: verify Gemini webhook signature before production use.
  // TODO: fetch output_file_uri, parse JSONL, validate schema, insert facts/chunks.
  await supabase.from('audit_logs').insert({ action: `gemini.${payload.type}`, metadata: payload })
  return new Response('ok', { status: 200 })
})
