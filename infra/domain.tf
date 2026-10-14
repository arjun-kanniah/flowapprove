# --- Custom domain ------------------------------------------------------------------------
#
# The hostname's DNS is on Cloudflare. The records are DNS-only (not proxied): Azure issues and
# renews a free managed certificate for the hostname, which needs to reach the app directly.
# Binding that certificate to the hostname is one `just bind-domain` after the first apply.

data "cloudflare_zone" "site" {
  count  = var.hostname != "" ? 1 : 0
  filter = { name = var.zone }
}

resource "cloudflare_dns_record" "app" {
  count   = var.hostname != "" && var.deploy_app ? 1 : 0
  zone_id = data.cloudflare_zone.site[0].zone_id
  name    = var.hostname
  type    = "CNAME"
  content = local.app_fqdn
  proxied = false
  ttl     = 300
  comment = "FlowApprove on Azure Container Apps"
}

# Proves to Azure that the hostname is ours before it serves or certifies it.
resource "cloudflare_dns_record" "verification" {
  count   = var.hostname != "" && var.deploy_app ? 1 : 0
  zone_id = data.cloudflare_zone.site[0].zone_id
  name    = "asuid.${var.hostname}"
  type    = "TXT"
  content = "\"${azurerm_container_app.main[0].custom_domain_verification_id}\""
  ttl     = 300
  comment = "Azure Container Apps domain verification"
}

resource "azurerm_container_app_custom_domain" "app" {
  count            = var.hostname != "" && var.deploy_app ? 1 : 0
  name             = var.hostname
  container_app_id = azurerm_container_app.main[0].id

  lifecycle {
    # The managed certificate is bound by `just bind-domain`; Terraform leaves the binding be
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }

  depends_on = [cloudflare_dns_record.app, cloudflare_dns_record.verification]
}

resource "azurerm_container_app_environment_managed_certificate" "app" {
  count                        = var.hostname != "" && var.deploy_app ? 1 : 0
  name                         = "cert-${replace(var.hostname, ".", "-")}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  subject_name                 = var.hostname
  domain_control_validation    = "CNAME"

  depends_on = [azurerm_container_app_custom_domain.app]
}
