# MRAK online platform on Google Cloud, EU (ADR 0011). One project + state per environment.
# Edge: infra/cloudflare. Paid content: R2 (Cloudflare). Runbooks: docs/runbooks/deploy.md.

data "google_project" "this" {}

locals {
  labels = { app = "mrak", env = var.env }
  # Secrets the API reads (env var name = secret id). Values never live in this repo.
  generated_secrets = ["DATABASE_URL", "REDIS_URL", "REDIS_CA_CERT", "AUTH_SECRET", "EDGE_SECRET"]
  manual_secrets = [
    "AUTH_JWT_KEYS", "TURNSTILE_SECRET", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET",
    "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "EMAIL_API_KEY",
  ]
  # Documented rotation (docs/runbooks/deploy.md → Secrets): Secret Manager notifies when due.
  rotation_days = {
    AUTH_JWT_KEYS = 90, AUTH_SECRET = 365, EDGE_SECRET = 180, DATABASE_URL = 180,
    REDIS_URL = 180, REDIS_CA_CERT = 1825, TURNSTILE_SECRET = 365, PADDLE_API_KEY = 180,
    PADDLE_WEBHOOK_SECRET = 180, R2_ACCESS_KEY_ID = 180, R2_SECRET_ACCESS_KEY = 180,
    EMAIL_API_KEY = 180,
  }
  # Mounted only once they have a version (manual ones are added with `gcloud secrets versions add`).
  mounted_secrets = concat(local.generated_secrets, var.manual_secrets_ready)
}

variable "manual_secrets_ready" {
  description = "Manual secrets that already have a version and are mounted into the API"
  type        = list(string)
  default     = ["AUTH_JWT_KEYS", "TURNSTILE_SECRET"]
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com", "sqladmin.googleapis.com", "redis.googleapis.com",
    "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "compute.googleapis.com",
    "servicenetworking.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com",
    "cloudtrace.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com",
    "billingbudgets.googleapis.com", "pubsub.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ---------------------------------------------------------------- network (private DB and Redis)

resource "google_compute_network" "vpc" {
  name                    = "mrak-${var.env}"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "run" {
  name                     = "run-${var.region}"
  network                  = google_compute_network.vpc.id
  region                   = var.region
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "services" {
  name          = "google-managed-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.services.name]
}

# ---------------------------------------------------------------- PostgreSQL (backups + PITR)

resource "google_sql_database_instance" "db" {
  name                = "mrak-${var.env}"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.db.deletion_protection
  depends_on          = [google_service_networking_connection.services]

  settings {
    tier                        = var.db.tier
    availability_type           = var.db.availability
    disk_size                   = var.db.disk_gb
    disk_autoresize             = true
    disk_autoresize_limit       = var.db.disk_gb * 5
    deletion_protection_enabled = var.db.deletion_protection
    user_labels                 = local.labels

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      location                       = "eu"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.db.log_retention_days
      backup_retention_settings {
        retained_backups = var.db.backups_retained
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day  = 7
      hour = 3
    }

    insights_config {
      query_insights_enabled = true
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }
}

resource "google_sql_database" "online" {
  name     = "online"
  instance = google_sql_database_instance.db.name
}

resource "random_password" "db" {
  length  = 40
  special = false
}

resource "google_sql_user" "online" {
  name     = "online"
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

# ---------------------------------------------------------------- Redis (AUTH + TLS)

resource "google_redis_instance" "cache" {
  name                    = "mrak-${var.env}"
  tier                    = var.redis.tier
  memory_size_gb          = var.redis.memory_gb
  region                  = var.region
  redis_version           = "REDIS_7_2"
  authorized_network      = google_compute_network.vpc.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  labels                  = local.labels
  depends_on              = [google_service_networking_connection.services]
}

# ---------------------------------------------------------------- secrets

resource "google_pubsub_topic" "secret_rotation" {
  name = "secret-rotation"
}

resource "google_pubsub_topic_iam_member" "secret_manager_publishes" {
  topic  = google_pubsub_topic.secret_rotation.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-secretmanager.iam.gserviceaccount.com"
}

resource "google_secret_manager_secret" "s" {
  for_each  = toset(concat(local.generated_secrets, local.manual_secrets))
  secret_id = each.key
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  topics {
    name = google_pubsub_topic.secret_rotation.id
  }
  rotation {
    rotation_period    = "${local.rotation_days[each.key] * 86400}s"
    next_rotation_time = timeadd(timestamp(), "${local.rotation_days[each.key] * 24}h")
  }
  lifecycle {
    ignore_changes = [rotation[0].next_rotation_time]
  }
  depends_on = [google_pubsub_topic_iam_member.secret_manager_publishes]
}

resource "random_password" "generated" {
  for_each = toset(["AUTH_SECRET", "EDGE_SECRET"])
  length   = 48
  special  = false
}

resource "google_secret_manager_secret_version" "generated" {
  for_each = {
    # libpq semantics: TLS required (Cloud SQL ENCRYPTED_ONLY) inside the private network.
    DATABASE_URL  = "postgresql://online:${random_password.db.result}@${google_sql_database_instance.db.private_ip_address}:5432/online?sslmode=require&uselibpqcompat=true"
    REDIS_URL     = "rediss://:${google_redis_instance.cache.auth_string}@${google_redis_instance.cache.host}:${google_redis_instance.cache.port}/0"
    REDIS_CA_CERT = google_redis_instance.cache.server_ca_certs[0].cert
    AUTH_SECRET   = random_password.generated["AUTH_SECRET"].result
    EDGE_SECRET   = random_password.generated["EDGE_SECRET"].result
  }
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = each.value
}

# ---------------------------------------------------------------- identities

resource "google_service_account" "api" {
  account_id   = "online-api"
  display_name = "online-api runtime"
}

resource "google_project_iam_member" "api" {
  for_each = toset(["roles/cloudtrace.agent", "roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api" {
  for_each  = toset(local.mounted_secrets)
  secret_id = google_secret_manager_secret.s[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account" "deploy" {
  account_id   = "github-deploy"
  display_name = "GitHub Actions deploy (Workload Identity Federation, no keys)"
}

resource "google_project_iam_member" "deploy" {
  for_each = toset(concat(
    ["roles/run.developer", "roles/artifactregistry.writer"],
    # Monthly restore drill clones and deletes instances — staging only.
    var.env == "staging" ? ["roles/cloudsql.admin"] : ["roles/cloudsql.viewer"],
  ))
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_acts_as_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.repository"   = "assertion.repository"
    "attribute.environment"  = "assertion.environment"
  }
  # Only this repository, and only jobs running in the matching GitHub environment (production
  # jobs need the environment's required reviewers).
  attribute_condition = "assertion.repository == '${var.github_repo}' && assertion.environment == '${var.env}'"
}

resource "google_service_account_iam_member" "github_deploys" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# ---------------------------------------------------------------- images

resource "google_artifact_registry_repository" "images" {
  repository_id = "mrak"
  format        = "DOCKER"
  location      = var.region
  labels        = local.labels
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }
  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------- online-api (Cloud Run)

resource "google_cloud_run_v2_service" "api" {
  name                = "online-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL" # the app refuses requests without the edge secret
  deletion_protection = var.env == "production"
  labels              = local.labels

  template {
    service_account                  = google_service_account.api.email
    max_instance_request_concurrency = var.api.concurrency
    timeout                          = "15s"

    scaling {
      min_instance_count = var.api.min_instances
      max_instance_count = var.api.max_instances # cost ceiling (ADR 0011)
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.run.id
      }
    }

    containers {
      image = var.api_image
      ports {
        container_port = 3000
      }
      resources {
        limits            = { cpu = var.api.cpu, memory = var.api.memory }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "CORS_ORIGINS"
        value = var.env == "production" ? "https://play.mrak.game,https://mrak.game" : "https://play-staging.mrak.game,https://staging.mrak.game"
      }
      env {
        name  = "APP_URL"
        value = var.env == "production" ? "https://mrak.game" : "https://staging.mrak.game"
      }
      env {
        name  = "SITE_URL"
        value = var.env == "production" ? "https://mrak.game" : "https://staging.mrak.game"
      }
      env {
        name  = "COOKIE_DOMAIN"
        value = "mrak.game"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      dynamic "env" {
        for_each = toset(local.mounted_secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 3
        failure_threshold = 10
      }
      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }
    }
  }

  lifecycle {
    # Releases are deployed by CI (image digest per revision); Terraform owns the rest.
    ignore_changes = [template[0].containers[0].image, client, client_version, template[0].revision]
  }
  depends_on = [google_secret_manager_secret_iam_member.api, google_secret_manager_secret_version.generated]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Migrations: `prisma migrate deploy` (Dockerfile target `migrate`) before every release.
resource "google_cloud_run_v2_job" "migrate" {
  name                = "online-api-migrate"
  location            = var.region
  deletion_protection = false
  labels              = local.labels
  template {
    task_count = 1
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "600s"
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      containers {
        image = var.api_image
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

# ---------------------------------------------------------------- logs: 30 days (GDPR retention)

resource "google_logging_project_bucket_config" "default" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "_Default"
  retention_days = 30
}

# ---------------------------------------------------------------- outputs

output "api_host" {
  description = "Cloudflare CNAME target and Host rewrite (infra/cloudflare api_origin_hosts)"
  value       = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
}

output "edge_secret" {
  description = "For infra/cloudflare edge_secrets (never print in CI logs)"
  value       = random_password.generated["EDGE_SECRET"].result
  sensitive   = true
}

output "deploy" {
  description = "GitHub environment variables for .github/workflows/deploy.yml"
  value = {
    GCP_PROJECT        = var.project_id
    GCP_REGION         = var.region
    GCP_WIF_PROVIDER   = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOY_SA      = google_service_account.deploy.email
    GCP_REGISTRY       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
    GCP_SQL_INSTANCE   = google_sql_database_instance.db.name
  }
}
