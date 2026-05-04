# IDIC Companion

SillyTavern side-window companion extension for chatting with your own IDIC character while reading a normal ST main chat.

## What gets uploaded to GitHub

If you want SillyTavern one-click install, upload a repo whose root contains:

- `manifest.json`
- `index.js`
- `style.css`
- `settings.html`

This workspace already has a ready-to-upload folder:

- `st-idic-companion-github-repo`

## What it does

- Adds an `IDIC Companion` side panel in SillyTavern.
- Treats ST sync units as full turns: `user input + following AI reply`.
- Scans the AI reply for modules, strips code, keeps visible text.
- Lets the user choose which modules to sync for the latest turn.
- Keeps recent turns as full text, older turns as summary-first context.
- Prefers built-in ST summary modules.
- Only auto-generates missing summaries if the user enables that toggle.
- Pulls synced IDIC role snapshots from the user’s own Supabase.
- Lets the side-window reply optionally read/write the same hippocampus memory.

## Important split: plugin-only vs hippocampus

This project now supports two layers:

1. `Plugin-only`
- You still need your own Supabase project.
- You only need the companion role snapshot table + bridge function.
- Side-window chat works even if hippocampus tables/RPC are not installed.

2. `Plugin + hippocampus`
- If the same role already uses hippocampus, the bridge will also recall and write back side-window chat memory.

In short:

- `Role sync` is the base requirement.
- `Hippocampus` is optional enhancement.

## Fast setup

1. Run the SQL in:
- `supabase/idic_companion_bootstrap.sql`

2. Deploy:
- `supabase/functions/idic-companion-bridge`

3. In IDIC:
- Open the hippocampus settings page.
- Fill `IDIC 陪读角色同步` Supabase URL + Publishable Key.
- If you already use hippocampus on the same project, you can leave them empty and it will reuse the hippocampus Supabase.
- Click `立即同步角色`.

4. In SillyTavern:
- Install this extension from GitHub.
- Fill `Bridge URL`
- optional `Bridge Token`
- if your Supabase function still verifies JWT, also fill `Function Auth Key` with the project's `Legacy anon key`
- fill your `IDIC Main API URL / Key / Model`
- open the panel
- click `Refresh Roles`
- choose a role

## What gets sent to the bridge

- Recent full ST turns
- Older summary chain
- Current-turn fast modules like status bar / HTML scene text
- Side-window transcript
- Selected IDIC role snapshot

The ST reading material is prompt-only context.
The side-window chat itself is the thing that can enter hippocampus.

## Files

- Bridge quickstart: [DEPLOY_SUPABASE_BRIDGE.md](DEPLOY_SUPABASE_BRIDGE.md)
- Bridge source: [supabase/functions/idic-companion-bridge](../supabase/functions/idic-companion-bridge)
- Bootstrap SQL: [supabase/idic_companion_bootstrap.sql](../supabase/idic_companion_bootstrap.sql)
