# MRAK edge (threat model C-01, C-02, C-03, C-18, C-31, C-39, C-46; ADR 0008, ADR 0012).
# Cloudflare Free plan. The sites call the API on their own origin (/api/*); a Pages Function adds
# the edge secret and forwards to Render. One state for the zone (entrypoint rulesets are one per
# phase): production hostnames plus staging ones, which sit behind Cloudflare Access.

locals {
  game    = "play.${var.domain}"
  landing = var.domain
  staging = {
    landing = "staging.${var.domain}"
    game    = "play-staging.${var.domain}"
  }
  sites = "{\"${local.game}\" \"${local.landing}\" \"${local.staging.game}\" \"${local.staging.landing}\"}"
  api   = "http.host in ${local.sites} and starts_with(http.request.uri.path, \"/api/\")"
}

# ---------------------------------------------------------------- zone hardening

resource "cloudflare_zone_setting" "ssl" {
  zone_id    = var.zone_id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "min_tls" {
  zone_id    = var.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "always_https" {
  zone_id    = var.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "security_level" {
  zone_id    = var.zone_id
  setting_id = "security_level"
  # Runbook step "under attack": switch to "under_attack".
  value = "medium"
}

# Anti-bot mode (Bot Fight Mode; Super Bot Fight Mode on paid plans).
resource "cloudflare_bot_management" "bots" {
  zone_id    = var.zone_id
  fight_mode = true
}

# ---------------------------------------------------------------- static sites (Cloudflare Pages)

# Deployed by .github/workflows/deploy.yml (wrangler direct upload). Production = branch `main`;
# staging = branch `staging` (preview alias). Hashed assets are immutable; HTML revalidates.
# The /api Function (functions/api/[[path]].ts) reads API_ORIGIN and EDGE_SECRET: production
# variables point at the production Render service, preview ones at staging.
resource "cloudflare_pages_project" "site" {
  for_each          = toset(["mrak-landing", "mrak-game"])
  account_id        = var.account_id
  name              = each.key
  production_branch = "main"
  deployment_configs = {
    production = {
      env_vars = {
        API_ORIGIN  = { type = "plain_text", value = var.api_origins.production }
        EDGE_SECRET = { type = "secret_text", value = var.edge_secrets.production }
      }
    }
    preview = {
      env_vars = {
        API_ORIGIN  = { type = "plain_text", value = var.api_origins.staging }
        EDGE_SECRET = { type = "secret_text", value = var.edge_secrets.staging }
      }
    }
  }
}

resource "cloudflare_pages_domain" "site" {
  for_each     = { "mrak-landing" = local.landing, "mrak-game" = local.game }
  account_id   = var.account_id
  project_name = cloudflare_pages_project.site[each.key].name
  name         = each.value
}

# Staging hostnames point at the `staging` branch alias (protect them with Cloudflare Access).
resource "cloudflare_dns_record" "staging_site" {
  for_each = { (local.staging.landing) = "mrak-landing", (local.staging.game) = "mrak-game" }
  zone_id  = var.zone_id
  name     = each.key
  type     = "CNAME"
  content  = "staging.${each.value}.pages.dev"
  proxied  = true
  ttl      = 1
}

# Staging is not public: only the team (and CI with a service token) passes Cloudflare Access.
resource "cloudflare_zero_trust_access_application" "staging" {
  account_id       = var.account_id
  name             = "MRAK staging"
  type             = "self_hosted"
  destinations     = [for host in values(local.staging) : { type = "public", uri = host }]
  session_duration = "12h"
  policies = [{
    name     = "team and CI"
    decision = "allow"
    include  = [{ email_domain = { domain = var.team_email_domain } }]
    }, {
    name     = "CI service token"
    decision = "non_identity"
    include  = [{ any_valid_service_token = {} }]
  }]
}

# ---------------------------------------------------------------- WAF
# Free plan: the Cloudflare Free Managed Ruleset is always on; custom rules (max 5) below. The
# full Managed and OWASP rulesets need Pro (re-add them when upgrading).

resource "cloudflare_ruleset" "waf_custom" {
  zone_id = var.zone_id
  name    = "mrak custom WAF"
  kind    = "zone"
  phase   = "http_request_firewall_custom"
  rules = [
    {
      description = "API: only the methods the API uses"
      expression  = "${local.api} and not http.request.method in {\"GET\" \"POST\" \"PATCH\" \"DELETE\" \"OPTIONS\"}"
      action      = "block"
      enabled     = true
    },
    {
      description = "API: no compressed request bodies (decompression bombs)"
      expression  = "${local.api} and any(http.request.headers[\"content-encoding\"][*] ne \"identity\")"
      action      = "block"
      enabled     = true
    },
    {
      description = "Static files accept no writes (only /api/ does)"
      expression  = "http.host in ${local.sites} and not starts_with(http.request.uri.path, \"/api/\") and not http.request.method in {\"GET\" \"HEAD\"}"
      action      = "block"
      enabled     = true
    },
  ]
}

# ---------------------------------------------------------------- edge rate limits

# Free plan: one rule, 10-second period and timeout. The API's own Redis limits (per route, IP,
# account) stay the real control; this is only a flood backstop in front of the Function.
resource "cloudflare_ruleset" "rate_limits" {
  zone_id = var.zone_id
  name    = "mrak edge rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"
  rules = [
    {
      description = "whole API backstop"
      expression  = local.api
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = var.edge_limits.api_per_10s
        mitigation_timeout  = 10
      }
      enabled = true
    },
  ]
}

# ---------------------------------------------------------------- caching (static never hits an origin)

resource "cloudflare_ruleset" "cache" {
  zone_id = var.zone_id
  name    = "mrak cache"
  kind    = "zone"
  phase   = "http_request_cache_settings"
  rules = [
    {
      description = "Content-hashed build assets: one year at the edge and in browsers"
      expression  = "http.host in {\"${local.game}\" \"${local.landing}\"} and (starts_with(http.request.uri.path, \"/app/\") or starts_with(http.request.uri.path, \"/_astro/\") or starts_with(http.request.uri.path, \"/assets/atlases/\") or starts_with(http.request.uri.path, \"/assets/audio/\"))"
      action      = "set_cache_settings"
      action_parameters = {
        cache       = true
        edge_ttl    = { mode = "override_origin", default = 31536000 }
        browser_ttl = { mode = "override_origin", default = 31536000 }
      }
      enabled = true
    },
    {
      description = "HTML, manifests and the rest: no zone cache, Pages serves the current deploy"
      expression  = "http.host in {\"${local.game}\" \"${local.landing}\"} and not (starts_with(http.request.uri.path, \"/app/\") or starts_with(http.request.uri.path, \"/_astro/\") or starts_with(http.request.uri.path, \"/assets/atlases/\") or starts_with(http.request.uri.path, \"/assets/audio/\"))"
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
      enabled = true
    },
    {
      description = "API responses are never cached (except what the API marks public)"
      expression  = local.api
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
      enabled = true
    },
  ]
}

# ---------------------------------------------------------------- paid content (R2, presigned only)

resource "cloudflare_r2_bucket" "paid_content" {
  for_each   = toset(["production", "staging"])
  account_id = var.account_id
  name       = each.key == "production" ? "mrak-paid-content" : "mrak-paid-content-staging"
  location   = "WEUR"
  # No custom domain and no r2.dev public URL: objects are reachable only through short-lived
  # presigned URLs issued by the API after an entitlement check (services/online-api/src/content).
}

# Encrypted nightly database dumps (.github/workflows/backup.yml); deleted after 30 days.
resource "cloudflare_r2_bucket" "backups" {
  account_id = var.account_id
  name       = "mrak-backups"
  location   = "WEUR"
}

resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.backups.name
  rules = [{
    id         = "expire-after-30-days"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 2592000 }
    }
  }]
}

# ---------------------------------------------------------------- alerts

resource "cloudflare_notification_policy" "ddos_l7" {
  account_id = var.account_id
  name       = "MRAK: HTTP DDoS attack"
  alert_type = "dos_attack_l7"
  enabled    = true
  mechanisms = { email = [{ id = var.alert_email }] }
}
