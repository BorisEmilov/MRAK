variable "env" {
  description = "staging or production — each in its own GCP project and state"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production."
  }
}

variable "project_id" {
  type = string
}

variable "billing_account" {
  description = "Billing account id (budget alerts)"
  type        = string
}

variable "region" {
  description = "EU region (ADR 0011): europe-west1, Belgium"
  type        = string
  default     = "europe-west1"
}

variable "github_repo" {
  description = "owner/name allowed to deploy through Workload Identity Federation"
  type        = string
  default     = "BorisEmilov/MRAK"
}

variable "alert_email" {
  type = string
}

variable "api_image" {
  description = "Initial image; later releases are deployed by CI (ignored by Terraform after create)"
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "api" {
  description = "online-api scaling: max_instances is the hard cost ceiling (ADR 0011)"
  type = object({
    min_instances = number
    max_instances = number
    cpu           = string
    memory        = string
    concurrency   = number
  })
}

variable "db" {
  type = object({
    tier                = string
    availability        = string # ZONAL | REGIONAL
    disk_gb             = number
    backups_retained    = number
    log_retention_days  = number # point-in-time recovery window (1–7)
    deletion_protection = bool
  })
}

variable "redis" {
  type = object({
    tier      = string # BASIC | STANDARD_HA
    memory_gb = number
  })
}

variable "monthly_budget_eur" {
  description = "Budget alerts at 50/80/100 % and forecast 100 %"
  type        = number
}

variable "alert_thresholds" {
  description = "Per 5 minutes unless noted"
  type = object({
    unauthorized_per_5m   = number
    rate_limited_per_5m   = number
    server_error_ratio    = number
    refresh_reuse_per_10m = number
    webhook_fail_per_15m  = number
    latency_p95_ms        = number
  })
  default = {
    unauthorized_per_5m   = 300
    rate_limited_per_5m   = 500
    server_error_ratio    = 0.01
    refresh_reuse_per_10m = 5
    webhook_fail_per_15m  = 3
    latency_p95_ms        = 1000
  }
}
