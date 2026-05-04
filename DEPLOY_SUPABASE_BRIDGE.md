# Supabase Bridge Quickstart

## 1. Run one SQL

Paste this file into Supabase SQL Editor and run it:

- `supabase/idic_companion_bootstrap.sql`

This creates the role snapshot table used by the SillyTavern companion plugin.

## 2. Deploy the edge function

Deploy:

- `supabase/functions/idic-companion-bridge`
- `supabase/config.toml`

Command:

```bash
supabase functions deploy idic-companion-bridge
```

Important:

- This bridge is configured with `verify_jwt = false` in `supabase/config.toml`.
- Supabase's newer `publishable key` is not the old JWT-style anon key.
- If the function was deployed before this config existed, redeploy it once.

## 3. Optional environment variables

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `IDIC_COMPANION_BRIDGE_TOKEN`

The plugin now sends the main API config in each request, so these bridge-side API env vars are only fallback:

- `IDIC_COMPANION_API_URL`
- `IDIC_COMPANION_API_KEY`
- `IDIC_COMPANION_API_MODEL`
- `IDIC_COMPANION_API_TEMPERATURE`

## 4. Configure IDIC-side role sync

In IDIC settings, open the hippocampus page and find:

- `IDIC 陪读角色同步`

Fill:

- `Supabase URL`
- `Publishable Key`

If you already use the same Supabase for hippocampus, you can leave them empty and it will reuse the hippocampus Supabase config.

Then click:

- `立即同步角色`

## 5. Configure SillyTavern extension

In the extension settings, fill:

- `Bridge URL`
- optional `Bridge Token` if you set `IDIC_COMPANION_BRIDGE_TOKEN`
- optional `Function Auth Key` can be left empty after redeploying with `verify_jwt = false`
- `IDIC Main API URL`
- `IDIC Main API Key`
- `IDIC Main Model`

If you see `UNAUTHORIZED_NO_AUTH_HEADER`, the function is still using old JWT verification. Redeploy the bridge with the included `supabase/config.toml`.

Then open the side panel, refresh roles, and pick the character you want for this ST chat.

## Hippocampus note

No hippocampus:

- role sync works
- side-window chatting works
- no memory recall/writeback

With hippocampus installed for that role:

- the side-window can read and write the same memory system
