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

variable "api_origins" {
  description = "Render service URL of online-api per environment (https://<service>.onrender.com)"
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

# Edge flood backstop (requests per 10 s per IP and colo; Free plan). Must match
# docs/runbooks/abuse.md.
variable "edge_limits" {
  type = object({
    api_per_10s = number
  })
  default = {
    api_per_10s = 100
  }
}
