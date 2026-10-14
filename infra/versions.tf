terraform {
  required_version = ">= 1.15"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.9.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9.0"
    }
  }

  # State lives in a storage account created by `just infra-bootstrap`, reached with your
  # Azure sign-in rather than an access key. Its names are passed at init.
  backend "azurerm" {
    use_azuread_auth = true
    container_name   = "tfstate"
    key              = "flowapprove.tfstate"
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # Storage accounts here have shared keys turned off, so data-plane calls use Entra ID
  storage_use_azuread = true
}
