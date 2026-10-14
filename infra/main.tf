data "azurerm_client_config" "current" {}

locals {
  # Secrets held in Key Vault: the app's environment variable => the secret's name.
  # Values are stored with `just secret <name>` (a hidden prompt), never by Terraform,
  # except the session secret, which Terraform generates.
  vault_secrets = {
    DATABASE_URL      = "database-url"
    ANTHROPIC_API_KEY = "anthropic-api-key"
    OPENAI_API_KEY    = "openai-api-key"
    GEMINI_API_KEY    = "gemini-api-key"
    SESSION_SECRET    = "session-secret"
  }
}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${var.name}"
  location = var.location
}

# --- Spending alert, before anything that costs money ------------------------------------

resource "azurerm_consumption_budget_resource_group" "monthly" {
  name              = "${var.name}-monthly"
  resource_group_id = azurerm_resource_group.main.id
  amount            = var.monthly_budget
  time_grain        = "Monthly"

  time_period {
    start_date = "${var.budget_start}T00:00:00Z"
  }

  dynamic "notification" {
    for_each = [50, 90, 100]
    content {
      operator       = "GreaterThanOrEqualTo"
      threshold      = notification.value
      threshold_type = "Actual"
      contact_emails = var.budget_emails
    }
  }

  notification {
    operator       = "GreaterThanOrEqualTo"
    threshold      = 100
    threshold_type = "Forecasted"
    contact_emails = var.budget_emails
  }

  lifecycle {
    # Azure fixes the start date once a budget exists
    ignore_changes = [time_period]
  }
}

# --- Logs: short retention and a daily cap keep them inside the free 5 GB a month ----------

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 0.15
}

# --- Identities: one the app runs as, one GitHub Actions deploys with ---------------------

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name}-app"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_user_assigned_identity" "deploy" {
  name                = "id-${var.name}-deploy"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

# Only this repository's main branch can sign in as the deploy identity: no stored keys.
# The subject names the repository by its numeric IDs as well as its name (see the variable).
resource "azurerm_federated_identity_credential" "github_main" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.deploy.id
  issuer                    = "https://token.actions.githubusercontent.com"
  audience                  = ["api://AzureADTokenExchange"]
  subject                   = var.github_oidc_subject
}

# Deploys update the app's image and run its jobs, all inside this resource group.
resource "azurerm_role_assignment" "deploy_rg" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

# --- Secrets ------------------------------------------------------------------------------

resource "azurerm_key_vault" "main" {
  name                       = "kv-${var.name}-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
}

# The app reads secrets; nothing else.
resource "azurerm_role_assignment" "app_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# You (whoever runs Terraform) store and update secret values with `just secret`.
resource "azurerm_role_assignment" "operator_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "random_password" "session" {
  length  = 48
  special = false
}

resource "azurerm_key_vault_secret" "session" {
  name         = "session-secret"
  value        = random_password.session.result
  key_vault_id = azurerm_key_vault.main.id
  depends_on   = [azurerm_role_assignment.operator_secrets]
}

# --- Quote files: private blobs, reached with the app's identity, no account keys ---------

resource "azurerm_storage_account" "files" {
  name                            = "st${var.name}${random_string.suffix.result}"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_container" "attachments" {
  name                  = "attachments"
  storage_account_id    = azurerm_storage_account.files.id
  container_access_type = "private"
  depends_on            = [azurerm_role_assignment.operator_blobs]
}

resource "azurerm_role_assignment" "app_blobs" {
  scope                = azurerm_storage_container.attachments.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Terraform itself creates the container over the data plane, so it needs blob access too.
resource "azurerm_role_assignment" "operator_blobs" {
  scope                = azurerm_storage_account.files.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.current.object_id
}

# --- The app ------------------------------------------------------------------------------

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${var.name}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  logs_destination           = "log-analytics"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
}
