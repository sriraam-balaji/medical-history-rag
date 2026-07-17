# Care Archive

Private, multi-profile medical-record archive with automated Gemini document processing, structured health extraction, cited vector search, and lab trend visualization.

🌐 **Live Web Application**: [https://medical-history-rag.pages.dev](https://medical-history-rag.pages.dev)

---

## Key Features

- **Multi-Profile Family Workspace**: Manage isolated medical records, prescriptions, and vitals for family members.
- **Automated Gemini Extraction Pipeline**: Structured parsing of handwritten doctor prescriptions, clinic letterheads (e.g., Gandhi Clinic, Gericare Hospital), Rx slips, lab reports (FBS, PPBS, HbA1c), and consultation notes using `gemini-3.1-flash-lite`.
- **Cited Archive Search (RAG)**: Ask natural-language questions across past medical records backed by vector embeddings generated via `gemini-embedding-2` / `text-embedding-004`.
- **Lab & Vital Trend Visualizations**: Interactive SVG chart tracking of repeated lab values and vitals against adult reference ranges.
- **Production-Grade Auditability**: Stores raw JSON extractions in `extraction_jobs` with schema validation (`v2-canonical`) and prompt versioning.
- **Full Provenance & Source Page Linking**: Every extracted medicine, vital, lab result, and doctor visit retains page references and raw evidence snippets linking back to source PDFs.
- **Rate Limit & Abuse Protection**: Strict 1-retry policy per document to protect API quota.

---

## Tech Stack

- **Frontend**: Vite, React 18, TypeScript, Lucide Icons, Vanilla CSS
- **Backend & Database**: Supabase (PostgreSQL with Row Level Security, Storage, Auth, Edge Functions in Deno)
- **AI Models**: Google Gemini API (`gemini-3.1-flash-lite` for multimodal extraction, `gemini-embedding-2` / `text-embedding-004` for 768-dim embeddings)
- **Hosting**: Cloudflare Pages (`wrangler.toml` & `public/_redirects`)

---

## Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sriraam-balaji/medical-history-rag.git
   cd medical-history-rag
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Add your Supabase URL and Publishable/Anon key to `.env.local`.

3. **Install Dependencies & Run Dev Server**:
   ```bash
   npm install
   npm run dev
   ```

4. **Database Schema & Edge Functions**:
   - Apply migration `supabase/migrations/202607170001_initial.sql` in your Supabase SQL Editor.
   - Deploy Edge Functions:
     ```bash
     npx supabase functions deploy enqueue-gemini-batch
     npx supabase functions deploy ask-archive
     ```
   - Configure backend secrets in Supabase Dashboard: `GEMINI_API_KEY`.

---

## Deployment

Configured for static deployment on **Cloudflare Pages**:
- **Build Output Directory**: `dist`
- **Build Command**: `npm run build`
- **SPA Rewrite Rule**: `public/_redirects` (`/* /index.html 200`)
