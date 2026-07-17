import { createClient } from '@supabase/supabase-js'

const defaultUrl = 'https://kxipxyexdliebwquqfil.supabase.co'
const defaultKey = 'sb_publishable_Z5tFq32csG6GafzM75ar1A_cfb2cefW'

const url = import.meta.env.VITE_SUPABASE_URL || defaultUrl
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaultKey

export const supabaseConfigured = Boolean(url && key)
export const supabase = supabaseConfigured ? createClient(url, key) : null

