# Observability (docs/runbooks/deploy.md → Observability): Cloud Run request metrics (latency,
# 4xx/5xx, 401, 429), log-based metrics from the API's PII-free metric events, a dashboard,
# alerts, an uptime check and the budget. Traces: Cloud Run samples requests into Cloud Trace and
# request logs carry the trace id.

variable "daily_instance_hours_alert" {
  description = "Cost anomaly proxy: Cloud Run billable instance-hours per day above this alerts"
  type        = number
  default     = 48
}

resource "google_monitoring_notification_channel" "email" {
  display_name = "MRAK ops (${var.env})"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

# ---------------------------------------------------------------- log-based metrics

locals {
  log_metrics = {
    # {evt:"audit", action, result} — logins, refresh reuse, purchases, webhooks… (no ids)
    audit_events = {
      filter = "jsonPayload.evt=\"audit\""
      labels = { action = "EXTRACT(jsonPayload.action)", result = "EXTRACT(jsonPayload.result)" }
    }
    emails_sent = {
      filter = "jsonPayload.evt=\"email\""
      labels = { kind = "EXTRACT(jsonPayload.kind)" }
    }
    # 429 per rate-limit policy (quotas)
    rate_limited = {
      filter = "jsonPayload.evt=\"rate-limited\""
      labels = { policy = "EXTRACT(jsonPayload.policy)" }
    }
    # email budget, Redis down, limiter degraded
    app_alerts = {
      filter = "jsonPayload.alert:*"
      labels = { alert = "EXTRACT(jsonPayload.alert)" }
    }
  }
}

resource "google_logging_metric" "m" {
  for_each = local.log_metrics
  name     = each.key
  filter   = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"online-api\" AND ${each.value.filter}"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    dynamic "labels" {
      for_each = each.value.labels
      content {
        key        = labels.key
        value_type = "STRING"
      }
    }
  }
  label_extractors = each.value.labels
}

# ---------------------------------------------------------------- dashboard

locals {
  run = "monitored_resource=\"cloud_run_revision\",service_name=\"online-api\""
  panels = {
    "Requests by class (per s)"     = "sum by (response_code_class) (rate(run_googleapis_com:request_count{${local.run}}[5m]))"
    "Latency p95 (ms)"              = "histogram_quantile(0.95, sum by (le) (rate(run_googleapis_com:request_latencies_bucket{${local.run}}[5m])))"
    "401 and 429 (per 5 min)"       = "sum by (response_code) (increase(run_googleapis_com:request_count{${local.run},response_code=~\"401|429\"}[5m]))"
    "Login failures (per 5 min)"    = "sum(increase(logging_googleapis_com:user_audit_events{action=\"login\",result=\"fail\"}[5m]))"
    "Refresh token reuse"           = "sum(increase(logging_googleapis_com:user_audit_events{action=\"refresh-reuse\"}[1h]))"
    "Purchases / webhook failures"  = "sum by (action, result) (increase(logging_googleapis_com:user_audit_events{action=~\"purchase|refund|chargeback|payment-webhook\"}[1h]))"
    "Emails sent by kind (per h)"   = "sum by (kind) (increase(logging_googleapis_com:user_emails_sent[1h]))"
    "429 by policy (quotas, per h)" = "sum by (policy) (increase(logging_googleapis_com:user_rate_limited[1h]))"
    "Instances (ceiling ${var.api.max_instances})" = "sum(run_googleapis_com:container_instance_count{${local.run}})"
    "Cloud SQL CPU"                 = "avg(cloudsql_googleapis_com:database_cpu_utilization)"
    "Redis memory usage ratio"      = "avg(redis_googleapis_com:stats_memory_usage_ratio)"
  }
}

resource "google_monitoring_dashboard" "main" {
  dashboard_json = jsonencode({
    displayName = "MRAK online-api (${var.env})"
    mosaicLayout = {
      columns = 12
      tiles = [for i, title in keys(local.panels) : {
        xPos   = (i % 2) * 6
        yPos   = floor(i / 2) * 4
        width  = 6
        height = 4
        widget = {
          title = title
          xyChart = {
            dataSets = [{ plotType = "LINE", timeSeriesQuery = { prometheusQuery = local.panels[title] } }]
          }
        }
      }]
    }
  })
}

# ---------------------------------------------------------------- alerts

locals {
  t = var.alert_thresholds
  alerts = {
    "5xx ratio above ${local.t.server_error_ratio * 100} %" = {
      q = "sum(rate(run_googleapis_com:request_count{${local.run},response_code_class=\"5xx\"}[5m])) / sum(rate(run_googleapis_com:request_count{${local.run}}[5m])) > ${local.t.server_error_ratio}"
      d = "Server errors. Check logs and the last release; roll back if it started with a deploy (docs/runbooks/deploy.md)."
    }
    "401 spike" = {
      q = "sum(increase(run_googleapis_com:request_count{${local.run},response_code=\"401\"}[5m])) > ${local.t.unauthorized_per_5m}"
      d = "Unusual 401s: forged tokens or credential stuffing (docs/runbooks/abuse.md)."
    }
    "429 spike" = {
      q = "sum(increase(run_googleapis_com:request_count{${local.run},response_code=\"429\"}[5m])) > ${local.t.rate_limited_per_5m}"
      d = "Rate limits shedding load: attack or a client bug (docs/runbooks/abuse.md)."
    }
    "Refresh token reuse" = {
      q = "sum(increase(logging_googleapis_com:user_audit_events{action=\"refresh-reuse\"}[10m])) > ${local.t.refresh_reuse_per_10m}"
      d = "Stolen refresh tokens being replayed (families revoked automatically). docs/runbooks/security-incident.md."
    }
    "Payment webhooks failing" = {
      q = "sum(increase(logging_googleapis_com:user_audit_events{action=\"payment-webhook\",result=\"fail\"}[15m])) > ${local.t.webhook_fail_per_15m}"
      d = "Invalid webhook signatures: secret mismatch after a rotation, or forgery attempts. Check Paddle's delivery log."
    }
    "Latency p95" = {
      q = "histogram_quantile(0.95, sum by (le) (rate(run_googleapis_com:request_latencies_bucket{${local.run}}[5m]))) > ${local.t.latency_p95_ms}"
      d = "Slow API: database, Redis or upstream (HIBP, Turnstile, Paddle)."
    }
    "App alert (email budget, Redis, limiter)" = {
      q = "sum by (alert) (increase(logging_googleapis_com:user_app_alerts[5m])) > 0"
      d = "The API raised an alert event: see the `alert` label and docs/runbooks/abuse.md."
    }
    "Instances at the ceiling" = {
      q = "max(run_googleapis_com:container_instance_count{${local.run}}) >= ${var.api.max_instances}"
      d = "Autoscaling reached the cost ceiling (ADR 0011). Raising it is a manual decision."
    }
    "Daily cost anomaly (instance-hours)" = {
      q = "sum(increase(run_googleapis_com:container_billable_instance_time{${local.run}}[1d])) / 3600 > ${var.daily_instance_hours_alert}"
      d = "Billable instance time far above normal for a day: abuse or a scaling bug."
    }
    "Secret rotation due" = {
      q = "sum(increase(pubsub_googleapis_com:topic_send_request_count{topic_id=\"secret-rotation\"}[1h])) > 0"
      d = "Secret Manager says a secret is due for rotation: follow docs/runbooks/deploy.md → Secrets."
    }
  }
}

resource "google_monitoring_alert_policy" "a" {
  for_each     = local.alerts
  display_name = "MRAK ${var.env}: ${each.key}"
  combiner     = "OR"
  severity     = "ERROR"
  conditions {
    display_name = each.key
    condition_prometheus_query_language {
      query               = each.value.q
      duration            = "60s"
      evaluation_interval = "60s"
    }
  }
  documentation {
    content   = each.value.d
    mime_type = "text/markdown"
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_uptime_check_config" "health" {
  display_name = "MRAK ${var.env} API health (through Cloudflare)"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type   = "uptime_url"
    labels = { project_id = var.project_id, host = var.env == "production" ? "api.mrak.game" : "api-staging.mrak.game" }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  display_name = "MRAK ${var.env}: API down"
  combiner     = "OR"
  conditions {
    display_name = "health check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.health.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
}

# ---------------------------------------------------------------- budget

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "MRAK ${var.env}"
  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      currency_code = "EUR"
      units         = tostring(var.monthly_budget_eur)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.8
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
  }
}
