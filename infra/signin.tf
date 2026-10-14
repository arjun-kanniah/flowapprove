# --- Sign-in with Microsoft accounts -------------------------------------------------------
#
# An app registration that any work, school or personal Microsoft account can sign in to.
# It has no client secret: the app proves who it is with a token from its managed identity,
# which this registration trusts through a federated credential.

data "azuread_client_config" "current" {}

locals {
  graph_app_id = "00000003-0000-0000-c000-000000000000" # Microsoft Graph
  # Sign-in scopes, by their fixed IDs: openid, profile, email
  signin_scopes = {
    openid  = "37f7f235-527c-4136-accd-4a02d197296e"
    profile = "14dad69e-099b-42c9-810b-d002981feec1"
    email   = "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0"
  }
}

resource "azuread_application" "signin" {
  display_name     = "FlowApprove"
  sign_in_audience = "AzureADandPersonalMicrosoftAccount"
  owners           = [data.azuread_client_config.current.object_id]

  api {
    # Personal accounts need v2 tokens
    requested_access_token_version = 2
  }

  web {
    homepage_url  = local.app_url
    redirect_uris = ["${local.app_url}/api/auth/entra/callback"]
  }

  required_resource_access {
    resource_app_id = local.graph_app_id
    dynamic "resource_access" {
      for_each = local.signin_scopes
      content {
        id   = resource_access.value
        type = "Scope"
      }
    }
  }

  optional_claims {
    id_token {
      name = "email"
    }
  }
}

resource "azuread_service_principal" "signin" {
  client_id = azuread_application.signin.client_id
  owners    = [data.azuread_client_config.current.object_id]
}

# The app's managed identity is this registration's only credential.
resource "azuread_application_federated_identity_credential" "app_identity" {
  application_id = azuread_application.signin.id
  display_name   = "container-app-identity"
  description    = "The FlowApprove container app's managed identity"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://login.microsoftonline.com/${data.azurerm_client_config.current.tenant_id}/v2.0"
  subject        = azurerm_user_assigned_identity.app.principal_id
}
