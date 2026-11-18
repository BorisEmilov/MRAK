variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "account_id" {
  type = string
}

variable "zone_id" {
  description = "Zone of mrak.game"
  type        = string
}

variable "domain" {
  type    = string
  default = "mrak.game"
}

variable "alert_email" {
  description = "Where DDoS and usage alerts go"
  type        = string
}

variable "api_origin_hosts" {
  description = "Cloud Run hostname of online-api per environment (output `api_host` of infra/gcp)"
  type        = object({ production = string, staging = string })
}

variable "edge_secrets" {
  description = "EDGE_SECRET of each environment (≥ 32 chars, from the secret store)"
  type        = object({ production = string, staging = string })
  sensitive   = true
}

variable "team_email_domain" {
  description = "Email domain allowed through Cloudflare Access to staging"
  type        = string
}

# Edge rate limits (requests per period per IP and colo). Must match docs/runbooks/abuse.md.
variable "edge_limits" {
  type = object({
    auth_per_min      = number
    telemetry_per_min = number
    checkout_per_min  = number
    api_per_min       = number
  })
  default = {
    auth_per_min      = 30
    telemetry_per_min = 30
    checkout_per_min  = 10
    api_per_min       = 600
  }
}
