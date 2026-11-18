# @mrak/studio-web

Visual content editor (docs/systems/studio.md): forms generated from the content JSON Schemas,
condition/effect editor with id autocomplete, React Flow graphs (quests, events, mysteries, pacts;
villager relations), mystery view, analysis panel and "Export to game".

`pnpm dev:studio` → http://127.0.0.1:5174 (proxies `/v1` to studio-api on :3100). In a
deployment studio-api serves the built UI (`STUDIO_WEB_DIR`) behind Cloudflare Access.

Security: internal tool — must never be exposed to the internet.
