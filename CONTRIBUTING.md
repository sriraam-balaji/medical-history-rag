# Contributing to Care Archive

Thanks for your interest! This is a small, focused project — contributions of all sizes are welcome.

## Getting started

1. Fork the repo and follow the **Setup** section in the README (you'll need your own free Supabase project and Gemini API key to test end-to-end; frontend-only changes can be tested with `npm run dev` against any configured project).
2. Create a branch from `master`.
3. Make your change. Keep PRs small and single-purpose.
4. `npm run build` must pass (CI runs it on every PR).
5. Open a PR describing what changed and why, with screenshots for UI changes.

## Guidelines

- **No secrets in code.** All keys come from environment variables or Supabase function secrets. `VITE_*` variables are public by definition — never put a service-role key there.
- **Privacy first.** Never commit real medical documents, patient names, clinic names, or extraction output from real records — including in tests, fixtures, screenshots, and prompt examples.
- **Database changes** go in a new file under `supabase/migrations/` (never edit an existing migration) and must respect the RLS model: users only see patient profiles they own.
- **Medical caution.** This is an archive tool, not a diagnostic one. Don't add features that interpret results or suggest treatment. Reference ranges must be clearly labeled as general guides.
- Match the existing code style (TypeScript, functional React, no extra dependencies without discussion — open an issue first for anything that adds a package).

## Good first issues

- Additional lab-test reference ranges (`generalRange` in `src/App.tsx`)
- More date formats in `parseFlexibleDate` (edge function)
- Dark mode
- i18n / translations
- Accessibility improvements

## Reporting bugs

Open a GitHub issue with steps to reproduce. **Redact any personal medical information from logs and screenshots before posting.**
