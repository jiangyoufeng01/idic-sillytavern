# idic-companion-bridge

Thin Supabase Edge Function for the `st-idic-companion` SillyTavern extension.

## Responsibilities

- List synced IDIC role snapshots from `idic_companion_role_snapshots`
- Accept ST reading-context payloads from the extension
- Generate side-window companion replies
- Optionally recall/write hippocampus memory if that role already uses hippocampus
- Summarize archived turns and roll them into stage summaries

## Required SQL

Run:

- `supabase/idic_companion_bootstrap.sql`

## Required env

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional env

- `IDIC_COMPANION_BRIDGE_TOKEN`

The extension can send API config per request, so these are only fallback defaults:

- `IDIC_COMPANION_API_URL`
- `IDIC_COMPANION_API_KEY`
- `IDIC_COMPANION_API_MODEL`
- `IDIC_COMPANION_API_TEMPERATURE`

## Deploy

```bash
supabase functions deploy idic-companion-bridge
```

This repo includes `supabase/config.toml`:

```toml
[functions.idic-companion-bridge]
verify_jwt = false
```

Keep that config when deploying. It allows users to use Supabase's current `publishable key` setup instead of hunting for a legacy anon JWT key.

Function URL:

```text
https://<project-ref>.functions.supabase.co/idic-companion-bridge
```

Put that URL into the SillyTavern extension setting:

- `Bridge URL`

If you set `IDIC_COMPANION_BRIDGE_TOKEN`, copy the same value into:

- `Bridge Token`
