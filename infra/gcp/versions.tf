terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # One state per environment: terraform init -backend-config="prefix=<env>"
  # The bucket is versioned, EU, uniform access, readable only by the infra admins (the state holds
  # the generated DB/Redis URLs).
  backend "gcs" {
    bucket = "mrak-terraform-state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
