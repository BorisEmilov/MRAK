terraform {
  required_version = ">= 1.9"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Token scoped to this account/zone only: Zone (DNS, WAF, Rulesets, Cache, Bot Management, Zone
# Settings) edit; Account (Cloudflare Tunnel, R2, Notifications) edit. From the secret store, never
# committed: TF_VAR_cloudflare_api_token.
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
