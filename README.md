# Care Archive

Private, multi-profile medical-record archive with automated Gemini document processing.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Add only the Supabase URL and publishable key to the frontend environment.
3. Run `npm install` and `npm run dev`.
4. Apply `supabase/migrations/202607170001_initial.sql` in the Supabase SQL Editor or through the Supabase CLI.

Backend secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and `GEMINI_WEBHOOK_SECRET`) belong only in Supabase Edge Function secrets.

## Current milestone

The repository includes the responsive dashboard shell, email magic-link and password authentication, patient-profile creation, private file upload UI, database schema, RLS foundation, and automated Gemini document extraction pipeline.

## Deployment

Configured for static deployment on **Cloudflare Pages** (`wrangler.toml` & `public/_redirects`).

