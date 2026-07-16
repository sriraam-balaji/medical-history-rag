export type PatientProfile = {
  id: string
  display_name: string
  created_at?: string
}

export type DocumentRecord = {
  id: string
  patient_id: string
  original_filename: string
  document_type: string | null
  processing_status: string
  created_at: string
}

export type Vital = {
  id: string
  measured_at: string
  vital_type: string
  value: number
  unit: string | null
  source_page: number | null
}
