# ADR 0008 — Cloudflare as the edge

- Status: accepted — the Cloudflare Tunnel origin is superseded by the edge secret of [ADR 0011](0011-hosting-gcp.md)
- Date: 2026-11-17
- Back to [threat model](../security/threat-model.md) · controls C-01, C-02, C-03, C-04, C-18, C-31, C-39

## Context

Expected scale and hostile traffic (bots, credential stuffing, layer-7 floods, cost attacks) make
it unsafe to expose the origin directly. The landing and the game are static; paid content needs
private storage with cheap egress.

## Decision

- All public hostnames (landing, game, `api.*`) are **proxied** by Cloudflare; the origin has no
  public ingress and is reached only through **Cloudflare Tunnel**. DNS, WAF, rate-limit rules,
  headers and Turnstile widgets are managed as code (Terraform in `infra/cloudflare`).
- **WAF:** Cloudflare managed ruleset + OWASP core ruleset on `api.*`; max request body 1 MB at the
  edge; only `GET, POST, PUT, DELETE, OPTIONS`.
- **Rate limiting at the edge** per route class (auth 10/min/IP, writes 60/min/IP, reads
  300/min/IP, telemetry 60/min/IP) in addition to app limits in Redis (defence in depth).
- **Turnstile** on register, login, reset and resend-verification, verified server-side.
- **Static hosting:** landing and game served with long-cache hashed assets, strict CSP and HSTS
  preload; HTML `no-cache`.
- **R2** private bucket for paid content; access only via presigned URLs (5 min) issued by the API
  after an entitlement check; no public bucket domain.
- **Under Attack mode** and stricter rules are part of the incident runbook; budget alerts on
  Cloudflare usage.
- Origin never trusts edge headers for identity; client IP is taken from `CF-Connecting-IP`
  only because the Tunnel guarantees the request came from Cloudflare.

## Consequences

- ✔ Absorbs volumetric and most layer-7 attacks before they cost origin CPU.
- ✔ Bot defences without CAPTCHAs for most users.
- ✘ Vendor dependency; TLS terminates at Cloudflare (origin leg re-encrypted via Tunnel).
- ✘ Config drift risk — mitigated by IaC and CI probes (CFG SEC-EDGE-*).

## Alternatives considered

- AWS CloudFront + WAF + S3: comparable, higher egress cost and more moving parts.
- No CDN, origin rate limiting only: origin pays for every abusive request; rejected.
