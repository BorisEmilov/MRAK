# MRAK edge (threat model C-01, C-02, C-03, C-18, C-31, C-39; ADR 0008).
# Everything public is proxied. The API origin (Cloud Run, ADR 0011) only serves requests that
# carry the edge secret this zone injects. One state for the zone (entrypoint rulesets are one per
# phase): production hostnames plus staging ones, which sit behind Cloudflare Access.

locals {
  game    = "play.${var.domain}"
  api     = "api.${var.domain}"
  landing = var.domain
  staging = {
    landing = "staging.${var.domain}"
    game    = "play-staging.${var.domain}"
    api     = "api-staging.${var.domain}"
  }
  api_hosts = { production = local.api, staging = local.staging.api }
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

# ---------------------------------------------------------------- API origin (Cloud Run, ADR 0011)

resource "cloudflare_dns_record" "api" {
  for_each = local.api_hosts
  zone_id  = var.zone_id
  name     = each.value
  type     = "CNAME"
  content  = var.api_origin_hosts[each.key]
  proxied  = true
  ttl      = 1
}


# Cloud Run routes by Host: rewrite it to the service hostname.
resource "cloudflare_ruleset" "api_origin" {
  zone_id = var.zone_id
  name    = "mrak api origin"
  kind    = "zone"
  phase   = "http_request_origin"
  rules = [for env, host in local.api_hosts : {
    description       = "API (${env}) → Cloud Run host"
    expression        = "http.host eq \"${host}\""
    action            = "route"
    action_parameters = { host_header = var.api_origin_hosts[env] }
    enabled           = true
  }]
}

# The edge secret proves a request came through this zone (and its WAF/limits); the API refuses
# anything else and only then trusts CF-Connecting-IP. "set" overwrites any client-sent value.
resource "cloudflare_ruleset" "api_edge_secret" {
  zone_id = var.zone_id
  name    = "mrak api edge secret"
  kind    = "zone"
  phase   = "http_request_late_transform"
  rules = [for env, host in local.api_hosts : {
    description = "Add x-mrak-edge to API requests (${env})"
    expression  = "http.host eq \"${host}\""
    action      = "rewrite"
    action_parameters = {
      headers = { "x-mrak-edge" = { operation = "set", value = var.edge_secrets[env] } }
    }
    enabled = true
  }]
}

# ---------------------------------------------------------------- static sites (Cloudflare Pages)

# Deployed by .github/workflows/deploy.yml (wrangler direct upload). Production = branch `main`;
# staging = branch `staging` (preview alias). Hashed assets are immutable; HTML revalidates.
resource "cloudflare_pages_project" "site" {
  for_each          = toset(["mrak-landing", "mrak-game"])
  account_id        = var.account_id
  name              = each.key
  production_branch = "main"
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
  domain           = local.staging.landing
  self_hosted_domains = values(local.staging)
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

resource "cloudflare_ruleset" "waf_managed" {
  zone_id = var.zone_id
  name    = "mrak managed WAF"
  kind    = "zone"
  phase   = "http_request_firewall_managed"
  rules = [
    {
      description       = "Cloudflare Managed Ruleset"
      expression        = "true"
      action            = "execute"
      action_parameters = { id = "efb7b8c949ac4650a09736fc376e9aee" }
      enabled           = true
    },
    {
      description       = "Cloudflare OWASP Core Ruleset"
      expression        = "http.host eq \"${local.api}\""
      action            = "execute"
      action_parameters = { id = "4814384a9e5d4991b9815dcfc25d2f1f" }
      enabled           = true
    },
  ]
}

resource "cloudflare_ruleset" "waf_custom" {
  zone_id = var.zone_id
  name    = "mrak custom WAF"
  kind    = "zone"
  phase   = "http_request_firewall_custom"
  rules = [
    {
      description = "API: only the methods the API uses"
      expression  = "http.host eq \"${local.api}\" and not http.request.method in {\"GET\" \"POST\" \"PATCH\" \"DELETE\" \"OPTIONS\"}"
      action      = "block"
      enabled     = true
    },
    {
      description = "API: no compressed request bodies (decompression bombs)"
      expression  = "http.host eq \"${local.api}\" and any(http.request.headers[\"content-encoding\"][*] ne \"identity\")"
      action      = "block"
      enabled     = true
    },
    {
      description = "Static sites accept no writes"
      expression  = "http.host in {\"${local.game}\" \"${local.landing}\"} and not http.request.method in {\"GET\" \"HEAD\"}"
      action      = "block"
      enabled     = true
    },
    {
      description = "Sign-up and recovery from likely bots: managed challenge"
      expression  = "http.host eq \"${local.api}\" and http.request.uri.path in {\"/v1/auth/register\" \"/v1/auth/forgot-password\" \"/v1/auth/resend-verification\"} and cf.bot_management.verified_bot eq false and cf.threat_score gt 10"
      action      = "managed_challenge"
      enabled     = true
    },
  ]
}

# ---------------------------------------------------------------- edge rate limits

resource "cloudflare_ruleset" "rate_limits" {
  zone_id = var.zone_id
  name    = "mrak edge rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"
  rules = [
    {
      description = "auth"
      expression  = "http.host eq \"${local.api}\" and starts_with(http.request.uri.path, \"/v1/auth/\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = var.edge_limits.auth_per_min
        mitigation_timeout  = 600
      }
      enabled = true
    },
    {
      description = "telemetry"
      expression  = "http.host eq \"${local.api}\" and starts_with(http.request.uri.path, \"/v1/telemetry\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = var.edge_limits.telemetry_per_min
        mitigation_timeout  = 600
      }
      enabled = true
    },
    {
      description = "purchases"
      expression  = "http.host eq \"${local.api}\" and (starts_with(http.request.uri.path, \"/v1/checkout\") or starts_with(http.request.uri.path, \"/v1/purchases\"))"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = var.edge_limits.checkout_per_min
        mitigation_timeout  = 600
      }
      enabled = true
    },
    {
      description = "whole API backstop"
      expression  = "http.host eq \"${local.api}\""
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = var.edge_limits.api_per_min
        mitigation_timeout  = 60
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
      expression  = "http.host eq \"${local.api}\""
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

# ---------------------------------------------------------------- alerts

resource "cloudflare_notification_policy" "ddos_l7" {
  account_id  = var.account_id
  name        = "MRAK: HTTP DDoS attack"
  alert_type  = "dos_attack_l7"
  enabled     = true
  mechanisms  = { email = [{ id = var.alert_email }] }
}
