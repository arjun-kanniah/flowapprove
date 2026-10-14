variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region. East US 2 sits close to the Neon database in AWS us-east-2 (Ohio)."
  type        = string
  default     = "eastus2"
}

variable "name" {
  description = "Base name for resources."
  type        = string
  default     = "flowapprove"
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy."
  type        = string
  default     = "arjun-kanniah/flowapprove"
}

variable "github_oidc_subject" {
  description = "Subject GitHub Actions presents from the main branch. GitHub now puts the owner's and repository's numeric IDs in it, so a deleted and recreated repository with the same name can't inherit access. From: gh api repos/<owner>/<repo>."
  type        = string
  default     = "repo:arjun-kanniah@33810967/flowapprove@1417627246:ref:refs/heads/main"
}

variable "deploy_app" {
  description = "Create the container app and its jobs. False for the first apply, before the secrets and images exist."
  type        = bool
  default     = true
}

variable "app_image" {
  description = "Image the app and the reset job start with; deploys replace it."
  type        = string
  default     = "ghcr.io/arjun-kanniah/flowapprove-app:latest"
}

variable "migrate_image" {
  description = "Image the migration job starts with; deploys replace it."
  type        = string
  default     = "ghcr.io/arjun-kanniah/flowapprove-migrate:latest"
}

variable "quote_check_model" {
  description = "Model for the AI quote check, as provider/model. Keep it cheap: the demo is public."
  type        = string
  default     = "gemini/gemini-3.5-flash-lite"
}

variable "monthly_budget" {
  description = "Monthly budget for the resource group, in the subscription's billing currency."
  type        = number
  default     = 20
}

variable "budget_emails" {
  description = "Who gets budget alerts. Kept in terraform.tfvars, out of the public repo."
  type        = list(string)
}

variable "budget_start" {
  description = "First month the budget covers (the first of a month, YYYY-MM-01)."
  type        = string
  default     = "2026-10-01"
}

variable "zone" {
  description = "Cloudflare zone (domain) the app's hostname is in."
  type        = string
  default     = "arjunkanniah.dev"
}

variable "hostname" {
  description = "Custom domain for the app. Empty serves it on its Container Apps address only."
  type        = string
  default     = "flowapprove.arjunkanniah.dev"
}
