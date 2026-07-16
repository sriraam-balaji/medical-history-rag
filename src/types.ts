export type PatientProfile = {
  id: string
  display_name: string
  date_of_birth?: string | null
  biological_sex?: string | null
  created_at?: string
}

export type DocumentRecord = {
  id: string
  patient_id: string
  original_filename: string
  storage_path: string
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

export type LabResult = {
  id: string
  test_name_raw: string
  test_name_normalized: string | null
  value_text: string | null
  numeric_value: number | null
  unit: string | null
  measured_at: string | null
  source_page: number | null
}

export type Medication = {
  id: string
  brand_name: string | null
  generic_name: string | null
  strength: string | null
  dosage_form: string | null
  route: string | null
  composition_status: string
}
