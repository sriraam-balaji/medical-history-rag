import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const MODEL = 'gemini-3.1-flash-lite'
const PROMPT = `You are an information extraction system for a medical archive. Your task is to classify the document and extract only information explicitly present in the document. Do not summarize, interpret, diagnose, or infer medical conclusions.

### CLASSIFICATION DEFINITIONS:
- "medical_document": Contains clinical health information such as doctor prescriptions (handwritten or printed), clinic letterheads, Rx slips, laboratory blood tests (FBS, PPBS, HbA1c), imaging reports, discharge summaries, vaccination records, consultation notes, or hospital bills.
- "non_medical": Contains zero health or clinical information.
- "uncertain": The scan quality or content is insufficient to determine clinical nature.

### GENERAL EXTRACTION RULES:
1. Preserve exact original wording for diagnoses, medications, test names, and instructions whenever practical. Extract blood pressure and test values exactly as written.
2. Do not normalize medical terminology beyond extracting raw values, date texts, and standard units.
3. Page numbering starts at 1 (1-indexed). Multi-page PDFs contain distinct pages (1, 2, 3, 4, 5, 6). You MUST attach the exact 1-indexed page integer ("page": 1, 2, 3...) to EVERY extracted item (medication, vital, lab test, visit date, instruction, diagnosis) based on which page of the PDF image array it physically appeared on.
4. DATES & TREND CHARTS / TABLES / SERIAL MEASUREMENTS:
   - Search the entire document for all dates printed anywhere (Report Date, Sample Collection Date, Visit Date, Header/Footer dates, and dates inside historical result tables, miniature trend charts, plotted graphs, previous result columns, serial measurements, or comparison tables like '16-Nov-18', '20-Aug-25', '06-Nov-25', '06/11/2025').
   - Preserve the exact association between each historical test reading/value and its corresponding date. If a report page contains historical comparison tables, trend graphs, or serial readings for a test (e.g. Haemoglobin on 16-Nov-18 = 13.6, 20-Aug-25 = 13.6, 06-Nov-25 = 14.2; ESR on 20-Aug-25 = 4, 06-Nov-25 = 7), extract EACH historical result reading as a separate object in "laboratory_results" or "vitals" with its corresponding "date_text" and "measured_at" date.
   - Extract raw date strings as "date_text" (e.g., "16-Nov-18", "06/11/2025 6:59 PM"). Provide "measured_at" as ISO "YYYY-MM-DD" when unambiguous. If a specific reading date is present, use it. Otherwise, use the page or document's collection, report, or visit date.
5. Deduplicate identical readings ONLY if they refer to the exact same measurement on the same date and same page.
6. If information is absent, use null for single values and [] for arrays. Never omit schema keys.

### OUTPUT JSON SCHEMA:
Return ONLY a valid JSON object matching this exact structure:
{
  "content_classification": "medical_document",
  "document_type": "lab_report",
  "patient": {
    "name": null,
    "dob": null,
    "sex": null
  },
  "provider": {
    "doctor_name": null,
    "facility_name": null,
    "specialty": null
  },
  "document_dates": [
    {
      "date_text": "06/11/2025 6:59 PM",
      "measured_at": "2025-11-06",
      "context": "Reported On",
      "page": 1
    }
  ],
  "medications": [
    {
      "brand_name": "Istamet",
      "generic_name": null,
      "strength": "50/500mg",
      "dosage_form": "tablet",
      "frequency": "1-0-1",
      "duration": "1 month",
      "status": "prescribed",
      "page": 1,
      "certainty": "explicit"
    }
  ],
  "vitals": [
    {
      "vital_type": "blood_pressure",
      "value_text": "120/80",
      "numeric_value": 120,
      "unit": "mmHg",
      "date_text": "06/11/2025",
      "measured_at": "2025-11-06",
      "page": 1
    }
  ],
  "laboratory_results": [
    {
      "test_name_raw": "Haemoglobin (Hb)",
      "test_name_normalized": "Hemoglobin",
      "numeric_value": 13.6,
      "value_text": "13.6",
      "unit": "gm/dL",
      "reference_range": "12-16",
      "date_text": "16-Nov-18",
      "measured_at": "2018-11-16",
      "page": 1
    },
    {
      "test_name_raw": "Haemoglobin (Hb)",
      "test_name_normalized": "Hemoglobin",
      "numeric_value": 14.2,
      "value_text": "14.2",
      "unit": "gm/dL",
      "reference_range": "12-16",
      "date_text": "06-Nov-25",
      "measured_at": "2025-11-06",
      "page": 1
    }
  ],
  "medical_events": [
    {
      "event_type": "consultation",
      "title": "Consultation at Sunrise Clinic",
      "doctor_name": "Dr A Sharma",
      "facility": "Sunrise Clinic",
      "visit_reason": null,
      "event_date": "2025-11-06",
      "date_text": "06/11/2025",
      "page": 1
    }
  ],
  "diagnoses": [
    {
      "raw_text": "Type 2 Diabetes Mellitus",
      "certainty": "explicit",
      "page": 1
    }
  ]
}`
const EMBEDDING_MODELS = ['gemini-embedding-2', 'text-embedding-004', 'embedding-001']
const FLASH_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash']
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

function isMedicalClassification(classification: string, validated: unknown): boolean {
  const c = String(classification || '').toLowerCase().trim()
  if (
    c === 'medical_document' ||
    c === 'prescription' ||
    c === 'medical_record' ||
    c === 'clinical_record' ||
    c === 'lab_report' ||
    c === 'consultation' ||
    c === 'doctor_note' ||
    c.includes('medical') ||
    c.includes('prescrit') ||
    c.includes('clinic') ||
    c.includes('doctor') ||
    c === 'uncertain'
  ) {
    return true
  }
  const root = asObject(validated)
  const patient = asObject(root.patient)
  if (
    asArray(patient.medications ?? root.medications ?? root.medicines ?? patient.prescriptions ?? root.prescriptions).length > 0 ||
    asArray(patient.laboratory_reports ?? root.laboratory_reports ?? root.lab_results).length > 0 ||
    asArray(patient.vitals ?? root.vitals).length > 0 ||
    asArray(patient.visits ?? root.visits ?? patient.appointments ?? root.appointments).length > 0 ||
    root.doctor_name || root.facility || root.hospital || root.clinic || root.doctor || root.diagnoses
  ) {
    return true
  }
  return false
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
  let lastErrorText = ''
  for (const model of FLASH_MODELS) {
    const response = await fetch(`${GEMINI}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { file_data: { mime_type: mimeType, file_uri: fileUri } }] }], generation_config: { response_mime_type: 'application/json' } }),
    })
    if (response.ok) {
      const output = await response.json()
      const text = output.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? ''
      let validated: unknown
      try {
        validated = JSON.parse(text)
      } catch {
        validated = { text_extracted: text, parse_warning: 'Model output was not valid JSON' }
      }
      return { output, validated }
    }
    lastErrorText = await response.text()
  }
  throw new Error(`Normal Gemini request failed across models: ${lastErrorText}`)
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

function parseFlexibleDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const str = value.trim()

  // 1. ISO format: YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (isoMatch) {
    const y = Number(isoMatch[1]); const m = Number(isoMatch[2]); const d = Number(isoMatch[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
  }

  // 2. Text month formats: DD-MMM-YY, DD-MMM-YYYY, DD MMM YYYY (e.g. "16-Nov-18", "20-Aug-25", "06-Nov-2025", "16 Nov 2018")
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  }
  const textMonthMatch = str.match(/^(\d{1,2})[\s\/\.\-]+([A-Za-z]+)[\s\/\.\-]+(\d{2}|\d{4})/)
  if (textMonthMatch) {
    const day = Number(textMonthMatch[1])
    const month = monthMap[textMonthMatch[2].toLowerCase()]
    let year = Number(textMonthMatch[3])
    if (textMonthMatch[3].length === 2) year = year > 50 ? 1900 + year : 2000 + year
    if (month && day >= 1 && day <= 31) return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  // 3. Text month first: MMM-DD-YY, MMM DD, YYYY
  const textMonthFirst = str.match(/^([A-Za-z]+)[\s\/\.\-]+(\d{1,2})[\s\/\.\,]+(\d{2}|\d{4})/)
  if (textMonthFirst) {
    const month = monthMap[textMonthFirst[1].toLowerCase()]
    const day = Number(textMonthFirst[2])
    let year = Number(textMonthFirst[3])
    if (textMonthFirst[3].length === 2) year = year > 50 ? 1900 + year : 2000 + year
    if (month && day >= 1 && day <= 31) return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  // 4. Indian numeric formats: DD/MM/YYYY or DD-MM-YYYY (e.g. "06/11/2025 6:59 PM" or "06-11-2025")
  const numericMatch = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2}|\d{4})/)
  if (numericMatch) {
    const day = Number(numericMatch[1])
    const month = Number(numericMatch[2])
    let year = Number(numericMatch[3])
    if (numericMatch[3].length === 2) year = year > 50 ? 1900 + year : 2000 + year
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  }

  const d = new Date(str)
  if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}

function dateOnly(value: unknown): string | null {
  return parseFlexibleDate(value)
}

function toIsoDateTime(value: unknown): string | null {
  const parsedDate = parseFlexibleDate(value)
  if (parsedDate) return `${parsedDate}T00:00:00.000Z`
  if (typeof value === 'string' && value) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

function dateTime(value: unknown): string | null {
  return toIsoDateTime(value)
}

async function embedText(text: string, apiKey: string): Promise<{ values: number[]; model: string }> {
  let lastErrorText = ''
  for (const model of EMBEDDING_MODELS) {
    const response = await fetch(`${GEMINI}/models/${model}:embedContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] }, output_dimensionality: 768 }),
    })
    if (response.ok) {
      const result = await response.json()
      const values = result.embeddings?.[0]?.values ?? result.embedding?.values
      if (Array.isArray(values) && values.length === 768) return { values, model }
    } else {
      lastErrorText = await response.text()
    }
  }
  throw new Error(`Embedding request failed across models: ${lastErrorText}`)
}

async function indexExtraction(service: ReturnType<typeof createClient>, document: any, extracted: unknown, apiKey: string) {
  const root = asObject(extracted)
  const patient = asObject(root.patient)
  const provider = asObject(root.provider)
  const documentType = String(root.document_type ?? root.document_category ?? 'Prescription / Medical record').trim().slice(0, 120)

  // 1. Audit Log: Store raw canonical JSON extraction for auditability, versioning, and re-processing
  try {
    await service.from('extraction_jobs').insert({
      document_id: document.id,
      status: 'completed',
      prompt_version: 'v3-strict-canonical',
      schema_version: 'v2',
      raw_json: JSON.stringify(extracted),
      error_message: null
    })
  } catch (_auditErr) {
    // Non-blocking audit log catch
  }

  // 2. Schema Validation & Normalization Layer
  const pageDateMap = new Map<number, string>()
  const pageDocumentDates = asArray(root.document_dates)
  for (const dateItem of pageDocumentDates) {
    const rawVal = typeof dateItem === 'object' && dateItem ? (dateItem.date ?? dateItem.date_text ?? dateItem.raw_date) : String(dateItem)
    const parsedDate = parseFlexibleDate(rawVal)
    const pageNum = typeof dateItem === 'object' && dateItem && typeof dateItem.page === 'number' ? dateItem.page : 1
    if (parsedDate) pageDateMap.set(pageNum, parsedDate)
  }

  // Explicit Date Fallback Precedence Hierarchy:
  // measurement date -> sample collection date -> report date -> visit date -> document header date -> document upload date
  const defaultDocDateRaw = root.measured_at ?? root.sample_date ?? root.report_date ?? root.date ?? root.visit_date ?? root.consultation_date
  const defaultDocDate = parseFlexibleDate(defaultDocDateRaw) || (document.created_at ? parseFlexibleDate(document.created_at) : null)

  const labs: any[] = []
  const labReports = asArray(patient.laboratory_reports ?? root.laboratory_reports ?? root.laboratory_results ?? root.lab_results ?? root.lab_reports ?? patient.laboratory_results)
  const seenLabKeys = new Set<string>()

  for (const report of labReports) {
    const reportPage = typeof report.page === 'number' ? report.page : 1
    const reportDateRaw = report.measured_at ?? report.sample_date ?? report.report_date ?? report.date ?? pageDateMap.get(reportPage) ?? defaultDocDate
    const results = asArray(report.results ?? report.tests ?? (report.test_name_raw || report.test || report.name ? [report] : []))
    for (const result of results) {
      const rawName = String(result.test_name_raw ?? result.test ?? result.name ?? '').trim()
      if (!rawName) continue
      const resPage = typeof result.page === 'number' ? result.page : reportPage
      
      // Strict Precedence Fallback for each measurement
      const resultDateRaw = result.measured_at ?? result.date ?? result.date_text ?? result.visit_date ?? reportDateRaw ?? pageDateMap.get(resPage) ?? defaultDocDate
      const measuredAt = toIsoDateTime(resultDateRaw) || (document.created_at ? new Date(document.created_at).toISOString() : null)

      let numVal: number | null = null
      if (typeof result.numeric_value === 'number') {
        numVal = result.numeric_value
      } else if (typeof result.value === 'number') {
        numVal = result.value
      } else {
        const parsedNum = parseFloat(String(result.value_text ?? result.value ?? ''))
        if (!Number.isNaN(parsedNum)) numVal = parsedNum
      }

      const valText = result.value_text != null ? String(result.value_text) : (result.value != null ? String(result.value) : null)
      
      // Deduplication: prevent identical readings on same date & page
      const dedupKey = `${rawName.toLowerCase()}|${numVal ?? valText}|${measuredAt?.split('T')[0]}|${resPage}`
      if (seenLabKeys.has(dedupKey)) continue
      seenLabKeys.add(dedupKey)

      labs.push({
        patient_id: document.patient_id,
        test_name_raw: rawName,
        test_name_normalized: result.test_name_normalized ?? result.normalized_name ?? null,
        value_text: valText,
        numeric_value: numVal,
        unit: result.unit ?? null,
        reference_range: result.reference_range ?? null,
        measured_at: measuredAt,
        source_document_id: document.id,
        source_page: resPage,
        evidence: JSON.stringify(result),
        confidence: result.certainty === 'explicit' ? 0.95 : 0.85,
      })
    }
  }

  const vitals: any[] = []
  const seenVitalKeys = new Set<string>()
  const rawVitalsList = asArray(patient.vitals ?? root.vitals)

  for (let idx = 0; idx < rawVitalsList.length; idx++) {
    const v = rawVitalsList[idx]
    const pageNum = typeof v.page === 'number' ? v.page : (idx + 1)
    const rawType = String(v.vital_type ?? v.type ?? v.name ?? 'Vital').trim()
    if (!rawType) continue

    const rawDate = v.measured_at ?? v.date ?? v.date_text ?? pageDateMap.get(pageNum) ?? defaultDocDate
    const measuredAt = toIsoDateTime(rawDate) || (document.created_at ? new Date(document.created_at).toISOString() : null)

    const rawValStr = String(v.value_text ?? v.value ?? v.numeric_value ?? '').trim()
    const isBp = rawType.toLowerCase().includes('blood_pressure') || rawType.toLowerCase().includes('blood pressure') || rawType.toLowerCase() === 'bp'
    
    // Blood Pressure Regex Normalization Layer:
    // Accept: 120/80, 120 / 80, 120-80, 120 over 80
    // Reject non-numeric qualitative text like "BP normal" or "BP controlled"
    const bpMatch = rawValStr.match(/^(\d{2,3})\s*(?:[\/\\-]|over)\s*(\d{2,3})/i)

    if (bpMatch || (isBp && /^\d{2,3}/.test(rawValStr))) {
      const sys = bpMatch ? Number(bpMatch[1]) : (typeof v.numeric_value === 'number' ? v.numeric_value : Number(rawValStr.match(/^\d+/)?.[0]) || null)
      const dia = bpMatch ? Number(bpMatch[2]) : null

      if (sys && Number.isFinite(sys)) {
        const sysKey = `systolic blood pressure|${sys}|${measuredAt?.split('T')[0]}|${pageNum}`
        if (!seenVitalKeys.has(sysKey)) {
          seenVitalKeys.add(sysKey)
          vitals.push({
            patient_id: document.patient_id,
            vital_type: 'Systolic Blood Pressure',
            value: sys,
            unit: v.unit ?? 'mmHg',
            measured_at: measuredAt,
            source_document_id: document.id,
            source_page: pageNum,
            evidence: JSON.stringify(v),
            confidence: v.certainty === 'explicit' ? 0.95 : 0.8,
          })
        }

      }

      if (dia && Number.isFinite(dia)) {
        const diaKey = `diastolic blood pressure|${dia}|${measuredAt?.split('T')[0]}|${pageNum}`
        if (!seenVitalKeys.has(diaKey)) {
          seenVitalKeys.add(diaKey)
          vitals.push({
            patient_id: document.patient_id,
            vital_type: 'Diastolic Blood Pressure',
            value: dia,
            unit: v.unit ?? 'mmHg',
            measured_at: measuredAt,
            source_document_id: document.id,
            source_page: pageNum,
            evidence: JSON.stringify(v),
            confidence: v.certainty === 'explicit' ? 0.95 : 0.8,
          })
        }
      }
    } else {
      // General Vital parsing (or qualitative text BP)
      const numVal = typeof v.numeric_value === 'number' ? v.numeric_value : (typeof v.value === 'number' ? v.value : Number(v.value) || Number(rawValStr) || 0)
      const key = `${rawType.toLowerCase()}|${numVal}|${measuredAt?.split('T')[0]}|${pageNum}`
      if (!seenVitalKeys.has(key)) {
        seenVitalKeys.add(key)
        vitals.push({
          patient_id: document.patient_id,
          vital_type: rawType,
          value: Number.isFinite(numVal) ? numVal : 0,
          unit: v.unit ?? null,
          measured_at: measuredAt,
          source_document_id: document.id,
          source_page: pageNum,
          evidence: JSON.stringify(v),
          confidence: v.certainty === 'explicit' ? 0.95 : 0.8,
        })
      }
    }
  }

  const medicationSource = asArray(patient.medications ?? root.medications ?? root.medicines ?? patient.prescriptions ?? root.prescriptions)
  const medications = medicationSource.flatMap((m, idx) => {
    const brand = m.brand_name ?? m.medicine ?? m.name ?? null
    const generic = m.generic_name ?? m.ingredient ?? null
    if (!brand && !generic) return []
    const pageNum = typeof m.page === 'number' ? m.page : (typeof m.source_page === 'number' ? m.source_page : (idx + 1))
    return [{
      patient_id: document.patient_id,
      brand_name: brand,
      generic_name: generic,
      strength: m.strength ?? m.dose ?? null,
      dosage_form: m.dosage_form ?? null,
      route: m.route ?? null,
      manufacturer: m.manufacturer ?? null,
      composition_status: m.status ?? m.composition_status ?? 'prescribed',
      source_document_id: document.id,
      source_page: pageNum,
      confidence: m.certainty === 'explicit' ? 0.95 : 0.85,
    }]
  })

  const visits = asArray(patient.visits ?? root.visits ?? patient.appointments ?? root.appointments)
  const eventsSource = asArray(patient.medical_events ?? root.medical_events ?? visits)
  const instructions = asArray(patient.care_instructions ?? root.care_instructions ?? root.instructions ?? root.recommendations)
  const events = [
    ...eventsSource.map((e) => ({
      event_date: dateOnly(e.event_date ?? e.date ?? e.visit_date),
      event_type: e.event_type ?? 'appointment',
      title: String(e.title ?? e.type ?? e.visit_type ?? 'Medical Visit'),
      summary: e.summary ?? e.reason ?? e.visit_reason ?? null,
      doctor_name: e.doctor_name ?? provider.doctor_name ?? root.doctor_name ?? null,
      specialty: e.specialty ?? provider.specialty ?? root.specialty ?? null,
      facility: e.facility ?? provider.facility_name ?? root.facility ?? null,
      visit_reason: e.visit_reason ?? e.reason ?? null,
      source_page: e.page ?? 1,
      evidence: JSON.stringify(e),
      confidence: 0.9,
    })),
    ...instructions.map((e) => ({
      event_date: dateOnly(e.date),
      event_type: 'care_instruction',
      title: String(e.instruction ?? e.text ?? e.recommendation ?? 'Care instruction'),
      summary: e.category ?? null,
      doctor_name: provider.doctor_name ?? null,
      specialty: null,
      facility: provider.facility_name ?? null,
      visit_reason: null,
      source_page: e.page ?? 1,
      evidence: JSON.stringify(e),
      confidence: 0.85,
    }))
  ].map((e) => ({ ...e, patient_id: document.patient_id, source_document_id: document.id }))

  // Extract distinct document dates from multi-page records as individual consultation events
  const eventDocumentDates = asArray(root.document_dates)
  for (const dateItem of eventDocumentDates) {
    const rawVal = typeof dateItem === 'object' && dateItem ? (dateItem.date ?? dateItem.raw_date) : String(dateItem)
    const parsedDate = dateOnly(rawVal)
    const pageNum = typeof dateItem === 'object' && dateItem && typeof dateItem.page === 'number' ? dateItem.page : 1
    if (parsedDate && !events.some((e) => e.event_date === parsedDate)) {
      events.push({
        patient_id: document.patient_id,
        source_document_id: document.id,
        event_date: parsedDate,
        event_type: 'consultation',
        title: provider.facility_name ? `Visit at ${provider.facility_name}` : (provider.doctor_name ? `Consultation with ${provider.doctor_name}` : 'Doctor Consultation'),
        summary: dateItem.raw_date ? `Prescription / Report dated ${dateItem.raw_date}` : 'Extracted visit date',
        doctor_name: provider.doctor_name ?? root.doctor_name ?? null,
        specialty: provider.specialty ?? root.specialty ?? null,
        facility: provider.facility_name ?? root.facility ?? null,
        visit_reason: null,
        source_page: pageNum,
        evidence: JSON.stringify(dateItem),
        confidence: 0.9,
      })
    }
  }

  const consultationDate = dateOnly(root.date ?? root.visit_date ?? root.consultation_date)
  const consultationFacility = provider.facility_name ?? root.facility ?? root.hospital ?? root.clinic ?? null
  const consultationDoctor = provider.doctor_name ?? root.doctor_name ?? root.doctor ?? null
  if (events.length === 0 && (consultationDate || consultationFacility || consultationDoctor || root.diagnoses)) {
    events.unshift({
      patient_id: document.patient_id,
      event_date: consultationDate,
      event_type: 'consultation',
      title: `${documentType} consultation`,
      summary: asArray(root.diagnoses).map((d: any) => typeof d === 'string' ? d : d.raw_text).filter(Boolean).join(', ') || null,
      doctor_name: consultationDoctor,
      specialty: provider.specialty ?? root.specialty ?? null,
      facility: consultationFacility,
      visit_reason: null,
      source_document_id: document.id,
      source_page: 1,
      evidence: JSON.stringify({ provider, date: consultationDate, diagnoses: root.diagnoses }),
      confidence: 0.85,
    })
  }

  // Sort events chronologically (newest first)
  events.sort((a, b) => {
    if (!a.event_date) return 1
    if (!b.event_date) return -1
    return b.event_date.localeCompare(a.event_date)
  })

  // 3. Delete existing records for this document to ensure clean idempotent overwrite
  for (const table of ['medical_events', 'medications', 'vitals', 'lab_results']) {
    requireDb(await service.from(table).delete().eq('source_document_id', document.id), `Clear ${table}`)
  }
  if (events.length) requireDb(await service.from('medical_events').insert(events), 'Insert medical events')
  if (medications.length) requireDb(await service.from('medications').insert(medications), 'Insert medications')
  if (vitals.length) requireDb(await service.from('vitals').insert(vitals), 'Insert vitals')
  if (labs.length) requireDb(await service.from('lab_results').insert(labs), 'Insert lab results')

  // 4. Chunk & Embed Canonical JSON for Vector RAG Search
  const serialized = JSON.stringify(extracted)
  const chunks = serialized.match(/.{1,5000}/gs) ?? [serialized]
  requireDb(await service.from('document_chunks').delete().eq('document_id', document.id), 'Clear document chunks')
  for (let index = 0; index < chunks.length; index++) {
    const { values: embedding, model: embeddingModel } = await embedText(chunks[index], apiKey)
    requireDb(await service.from('document_chunks').insert({
      patient_id: document.patient_id,
      document_id: document.id,
      chunk_index: index,
      content: chunks[index],
      embedding: `[${embedding.join(',')}]`,
      metadata: { source: embeddingModel, model_version: embeddingModel, prompt_version: 'v3-strict-canonical' }
    }), 'Insert document chunk')
  }

  // 5. Update Document Status to 'indexed' with Classification & Type Metadata
  await service.from('documents').update({
    processing_status: 'indexed',
    content_classification: 'medical_document',
    document_type: documentType,
    processed_at: new Date().toISOString()
  }).eq('id', document.id)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const auth = request.headers.get('Authorization')
  if (!auth) return json({ error: 'Authentication required' }, 401)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: userData } = await userClient.auth.getUser()
  if (!userData.user) return json({ error: 'Invalid session' }, 401)

  const body = await request.json().catch(() => null)
  const targetDocumentId = typeof body?.document_id === 'string' ? body.document_id : null

  let documents: Array<{ id: string; patient_id: string; original_filename: string; storage_path: string }> = []
  if (targetDocumentId) {
    const { data: document, error } = await service.from('documents').select('id, patient_id, original_filename, storage_path').eq('id', targetDocumentId).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (document) {
      const { data: profile, error: profileError } = await service.from('patient_profiles').select('owner_user_id').eq('id', document.patient_id).maybeSingle()
      if (profileError) return json({ error: profileError.message }, 500)
      if (profile?.owner_user_id === userData.user.id) documents = [document]
    }
  } else {
    const { data: pending, error } = await service.from('documents').select('id, patient_id, original_filename, storage_path').in('processing_status', ['queued', 'processing', 'failed_retryable']).limit(25)
    if (error) return json({ error: error.message }, 500)
    const patientIds = [...new Set((pending ?? []).map((document) => document.patient_id))]
    const { data: ownedProfiles, error: profileError } = patientIds.length
      ? await service.from('patient_profiles').select('id').in('id', patientIds).eq('owner_user_id', userData.user.id)
      : { data: [], error: null }
    if (profileError) return json({ error: profileError.message }, 500)
    const ownedIds = new Set((ownedProfiles ?? []).map((profile) => profile.id))
    documents = (pending ?? []).filter((document) => ownedIds.has(document.patient_id))
  }
  if (!documents.length) return json({ message: 'No documents to process', count: 0 })
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY is not configured' }, 503)

  const uploadedFiles: Array<{ id: string; patient_id: string; storage_path: string; uri: string; mimeType: string }> = []
  for (const document of documents) {
    try {
      const claimed = await service.from('documents').update({ processing_status: 'processing' }).eq('id', document.id).select('id').maybeSingle()
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
        if (!isMedicalClassification(classification, fallback.validated)) throw new Error(`NonMedicalDocument: Gemini classified this upload as ${classification || 'uncertain'}. Only medical records are accepted.`)
        await indexExtraction(service, file, fallback.validated, geminiKey)
        await service.from('extraction_jobs').delete().eq('document_id', file.id)
        requireDb(await service.from('extraction_jobs').insert({ document_id: file.id, status: 'indexed', raw_output: fallback.output, validated_output: fallback.validated, model_version: MODEL, prompt_version: 'v1-fallback', schema_version: 'v1' }), 'Save extraction job')
        const indexedRoot = asObject(fallback.validated)
        requireDb(await service.from('documents').update({ processing_status: 'indexed', content_classification: 'medical_document', document_type: String(indexedRoot.document_type ?? indexedRoot.document_category ?? 'Medical record').slice(0, 120), rejection_reason: null, processed_at: new Date().toISOString() }).eq('id', file.id), 'Mark document indexed')
        fallbackResults.push({ id: file.id, status: 'indexed', embedding_model: EMBEDDING_MODELS[0] })
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
