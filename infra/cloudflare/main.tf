# MRAK edge (threat model C-01, C-02, C-03, C-18, C-31, C-39; ADR 0008).
# Everything public is proxied; the API origin has no public ingress (Cloudflare Tunnel only).

locals {
  game    = "play.${var.domain}"
  api     = "api.${var.domain}"
  landing = var.domain
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

# ---------------------------------------------------------------- API through a tunnel

resource "cloudflare_zero_trust_tunnel_cloudflared" "api" {
  account_id    = var.account_id
  name          = "mrak-online-api"
  config_src    = "cloudflare"
  tunnel_secret = var.tunnel_secret
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "api" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.api.id
  config = {
    ingress = [
      { hostname = local.api, service = var.api_origin },
      # Anything else (including the studio) is refused at the tunnel.
      { service = "http_status:404" },
    ]
  }
}

resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = local.api
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.api.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

# play.* and the apex are Cloudflare Pages projects (static); their DNS records are created by
# the Pages custom-domain binding, always proxied. No record ever points at an origin IP.

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
      description = "Hashed build assets: one year at the edge and in browsers"
      expression  = "http.host in {\"${local.game}\" \"${local.landing}\"} and starts_with(http.request.uri.path, \"/assets/\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache       = true
        edge_ttl    = { mode = "override_origin", default = 31536000 }
        browser_ttl = { mode = "override_origin", default = 31536000 }
      }
      enabled = true
    },
    {
      description = "HTML and the rest of the static sites: short edge cache"
      expression  = "http.host in {\"${local.game}\" \"${local.landing}\"} and not starts_with(http.request.uri.path, \"/assets/\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache    = true
        edge_ttl = { mode = "override_origin", default = 300 }
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
  account_id = var.account_id
  name       = "mrak-paid-content"
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

resource "cloudflare_notification_policy" "tunnel_health" {
  account_id = var.account_id
  name       = "MRAK: API tunnel unhealthy"
  alert_type = "tunnel_health_event"
  enabled    = true
  mechanisms = { email = [{ id = var.alert_email }] }
}
