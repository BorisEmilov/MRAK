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

variable "tunnel_secret" {
  description = "Base64 32-byte secret of the API tunnel (secret store)"
  type        = string
  sensitive   = true
}

variable "api_origin" {
  description = "Service the tunnel forwards to, inside the private network"
  type        = string
  default     = "http://online-api:3000"
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
