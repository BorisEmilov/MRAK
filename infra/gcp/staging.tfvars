env             = "staging"
project_id      = "mrak-staging"
billing_account = "REPLACE-ME"
alert_email     = "ops@mrak.game"
api = {
  min_instances = 0
  max_instances = 2
  cpu           = "1"
  memory        = "512Mi"
  concurrency   = 80
}
db = {
  tier                = "db-g1-small"
  availability        = "ZONAL"
  disk_gb             = 10
  backups_retained    = 7
  log_retention_days  = 3
  deletion_protection = false
}
redis = {
  tier      = "BASIC"
  memory_gb = 1
}
monthly_budget_eur = 60
