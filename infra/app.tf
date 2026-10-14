locals {
  app_name = "ca-${var.name}"
  app_fqdn = "${local.app_name}.${azurerm_container_app_environment.main.default_domain}"
  app_url  = var.hostname != "" ? "https://${var.hostname}" : "https://${local.app_fqdn}"

  # Settings shared by the app and the nightly reset job
  app_env = {
    NODE_ENV                  = "production"
    AUTH_MODE                 = "demo"
    DEMO_MODE                 = "true"
    EMAIL_DELIVERY            = "log"
    APP_URL                   = local.app_url
    QUOTE_CHECK_MODEL         = var.quote_check_model
    AZURE_STORAGE_ACCOUNT_URL = azurerm_storage_account.files.primary_blob_endpoint
    AZURE_STORAGE_CONTAINER   = azurerm_storage_container.attachments.name
    # DefaultAzureCredential signs in as this identity
    AZURE_CLIENT_ID = azurerm_user_assigned_identity.app.client_id
    # Sign-in with Microsoft accounts (signin.tf)
    ENTRA_CLIENT_ID = azuread_application.signin.client_id
    ENTRA_TENANT    = "common"
  }
}

resource "azurerm_container_app" "main" {
  count                        = var.deploy_app ? 1 : 0
  name                         = local.app_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  dynamic "secret" {
    for_each = local.vault_secrets
    content {
      name                = secret.value
      key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/${secret.value}"
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto" # HTTP/1.1 and WebSockets, for live updates
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    # One instance at most: live updates and rate limits are held in memory. Scales to zero.
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "app"
      image  = var.app_image
      cpu    = 0.5
      memory = "1Gi"

      dynamic "env" {
        for_each = local.app_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.vault_secrets
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      readiness_probe {
        transport        = "HTTP"
        port             = 8080
        path             = "/api/health"
        interval_seconds = 10
      }
    }
  }

  lifecycle {
    # Deploys (GitHub Actions) set the image; Terraform owns everything else
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.app_secrets, azurerm_role_assignment.app_blobs]
}

# Applies migrations; each deploy updates its image and runs it before the new revision.
resource "azurerm_container_app_job" "migrate" {
  count                        = var.deploy_app ? 1 : 0
  name                         = "caj-${var.name}-migrate"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 1

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/database-url"
    identity            = azurerm_user_assigned_identity.app.id
  }

  template {
    container {
      name   = "migrate"
      image  = var.migrate_image
      cpu    = 0.25
      memory = "0.5Gi"
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.app_secrets]
}

# Resets the public demo to its sample data every night.
resource "azurerm_container_app_job" "reset" {
  count                        = var.deploy_app ? 1 : 0
  name                         = "caj-${var.name}-reset"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 1

  schedule_trigger_config {
    cron_expression          = "0 8 * * *" # 08:00 UTC, the middle of the night in the Americas
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  dynamic "secret" {
    for_each = { DATABASE_URL = "database-url", SESSION_SECRET = "session-secret" }
    content {
      name                = secret.value
      key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/${secret.value}"
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  template {
    container {
      name    = "reset"
      image   = var.app_image
      cpu     = 0.25
      memory  = "0.5Gi"
      command = ["node", "dist/seed-cli.js"]

      dynamic "env" {
        for_each = local.app_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = { DATABASE_URL = "database-url", SESSION_SECRET = "session-secret" }
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.app_secrets, azurerm_role_assignment.app_blobs]
}
