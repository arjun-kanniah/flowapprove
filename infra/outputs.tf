output "url" {
  description = "Where the app is served."
  value       = local.app_url
}

output "key_vault_name" {
  description = "For `just secret`: the vault the app's secrets go in."
  value       = azurerm_key_vault.main.name
}

# Repository variables for the deploy job (Settings > Secrets and variables > Actions > Variables).
output "github_variables" {
  description = "Set these as GitHub repository variables."
  value = {
    AZURE_CLIENT_ID       = azurerm_user_assigned_identity.deploy.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = var.subscription_id
    AZURE_RESOURCE_GROUP  = azurerm_resource_group.main.name
    CONTAINER_APP         = local.app_name
    MIGRATE_JOB           = "caj-${var.name}-migrate"
    PUBLIC_URL            = local.app_url
  }
}
