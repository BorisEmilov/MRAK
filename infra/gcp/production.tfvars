env             = "production"
project_id      = "mrak-production"
billing_account = "REPLACE-ME"
alert_email     = "ops@mrak.game"
api = {
  min_instances = 1
  max_instances = 4 # hard ceiling: 4 × DB_POOL_MAX 10 = 40 connections < max_connections
  cpu           = "1"
  memory        = "512Mi"
  concurrency   = 80
}
db = {
  tier                = "db-custom-1-3840"
  availability        = "REGIONAL"
  disk_gb             = 20
  backups_retained    = 30
  log_retention_days  = 7
  deletion_protection = true
}
redis = {
  tier      = "STANDARD_HA"
  memory_gb = 1
}
monthly_budget_eur = 250
