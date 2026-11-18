# infra/cloudflare — the edge as code

Terraform (Cloudflare provider v5) for everything in front of MRAK: [ADR 0008](../../docs/adr/0008-cloudflare-edge.md),
threat model C-01 … C-03, C-18, C-31, C-39, runbook [abuse](../../docs/runbooks/abuse.md).

| File           | What                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tf`      | Zone hardening, Bot Fight Mode, API tunnel + DNS, managed/OWASP/custom WAF, edge rate limits (`/v1/auth/*`, `/v1/telemetry`, checkout, API backstop), cache rules, private R2 bucket, DDoS/tunnel alerts |
| `variables.tf` | Inputs; edge limits are variables so the runbook can tighten them with one apply                                                                                                                         |

```sh
export TF_VAR_cloudflare_api_token=…   # from the secret store
terraform init && terraform plan -var-file=prod.tfvars   # prod.tfvars is not committed
```

Rules:

- The API host has **no origin IP**: `cloudflared` runs next to `online-api` and dials out to
  Cloudflare. The server firewall allows **no inbound** traffic on 80/443.
- Game and landing are Cloudflare Pages projects (static); hashed assets are cached for a year, so
  almost no request reaches anything we pay for per request.
- Edge `http_ratelimit` rules with a 60 s period need the Pro plan or higher (Free allows 10 s).
- DDoS L3/4/7 protection is always on; the HTTP DDoS managed ruleset uses default sensitivity.
- Budget alerts: Cloudflare usage is flat-rate for the zone; R2 and the hosting provider have
  budget alerts at 50 % and 80 % configured in their consoles (see the runbook checklist).
- Autoscaling ceiling of the API: **max 4 instances** (each: pool of 10 DB connections, Postgres
  `max_connections` 100). Set in the hosting provider; scaling beyond it is a manual decision.
