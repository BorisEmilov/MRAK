# infra/cloudflare — the edge as code

Terraform (Cloudflare provider v5, **Free plan**) for everything in front of MRAK:
[ADR 0008](../../docs/adr/0008-cloudflare-edge.md), [ADR 0012](../../docs/adr/0012-hosting-free-tier.md),
threat model C-01 … C-03, C-18, C-31, C-39, C-46, runbook [abuse](../../docs/runbooks/abuse.md).

| File           | What                                                                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tf`      | Zone hardening, Bot Fight Mode, Pages projects/domains with the `/api` Function's `API_ORIGIN` and `EDGE_SECRET`, staging behind Access, custom WAF, edge flood backstop, cache rules, private R2 buckets (paid content, backups with a 30-day lifecycle), DDoS alert |
| `variables.tf` | Inputs; the edge limit is a variable so the runbook can tighten it with one apply                                                                                                                                                                                     |

```sh
export TF_VAR_cloudflare_api_token=…   # from the secret store
terraform init && terraform plan -var-file=prod.tfvars   # prod.tfvars is not committed
```

The state is local (`terraform.tfstate`, gitignored). It contains the edge secrets: keep a copy in
the password manager, never in the repository.

Rules:

- The API is reached only through `/api/*` on each site: the Pages Function adds the
  `x-mrak-edge` secret and the client IP, and the API (Render) refuses requests without the
  secret. One state covers both environments, because entrypoint rulesets are one per phase per
  zone.
- Game and landing are Cloudflare Pages projects (static); hashed assets are cached for a year, so
  almost no request reaches anything with a quota.
- Free plan limits: one `http_ratelimit` rule with a 10 s period (the API's Redis limits are the
  real control), five custom WAF rules, the Free Managed Ruleset only (the Managed and OWASP
  rulesets need Pro).
- DDoS L3/4/7 protection is always on; the HTTP DDoS managed ruleset uses default sensitivity.
- R2 needs a payment method on file even within the free tier.
