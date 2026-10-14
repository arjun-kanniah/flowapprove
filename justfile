# FlowApprove task runner. Run `just` to list recipes.

set dotenv-load

# The personal Azure login, kept apart from any other account (see the README)
export AZURE_CONFIG_DIR := env("AZURE_CONFIG_DIR", env("HOME") / ".azure-flowapprove")
export DATABASE_URL := env("DATABASE_URL", "postgresql://flowapprove:flowapprove@localhost:5433/flowapprove")

_default:
    @just --list

# Install dependencies and generate the database client
setup:
    npm ci
    cd api && npx prisma generate

# Start the local Postgres 18 database (port 5433)
db:
    docker compose up -d --wait db

# Apply migrations to the database (starts the local one first, unless in CI)
migrate:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -n "${CI:-}" ] || docker compose up -d --wait db
    cd api && npx prisma migrate deploy

# Create a migration after changing api/prisma/schema.prisma, e.g. `just migration add_x`
migration name: db
    cd api && npx prisma migrate dev --name {{name}}

# Replace the local data with the demo personas and requests
seed: migrate
    cd api && npx tsx src/seed-cli.ts

# Stop local services (data is kept in a Docker volume)
down:
    docker compose down

# Run the API with reload on :8080
dev-api:
    cd api && npm run dev

# Run the web app on :5174 (proxies /api and live updates to :8080)
dev-web:
    cd web && npm run dev

# Lint and type-check everything
lint:
    npm run lint

# Run all tests (API tests use the local database)
test: migrate
    npm test

# Everything CI runs
check: lint test
    npm run build

# --- Azure (always the separate ~/.azure-flowapprove sign-in) ---

# One-time: create the Terraform state storage (signed in with your account, no keys) and init
infra-bootstrap:
    #!/usr/bin/env bash
    set -euo pipefail
    sub=$(az account show --query id -o tsv)
    me=$(az ad signed-in-user show --query id -o tsv)
    # Container Apps isn't enabled on new subscriptions by default (free, one-time)
    az provider register --namespace Microsoft.App --wait
    rg=rg-flowapprove-tfstate
    account=stfatfstate$(echo -n "$sub" | sha256sum | cut -c1-8)
    az group create --name "$rg" --location eastus2 --output none
    if ! az storage account show --name "$account" --resource-group "$rg" --output none 2>/dev/null; then
        az storage account create --name "$account" --resource-group "$rg" --location eastus2 \
            --sku Standard_LRS --min-tls-version TLS1_2 --allow-blob-public-access false \
            --allow-shared-key-access false --output none
    fi
    az storage account blob-service-properties update --account-name "$account" \
        --resource-group "$rg" --enable-versioning true --output none
    az role assignment create --assignee-object-id "$me" --assignee-principal-type User \
        --role "Storage Blob Data Contributor" \
        --scope "$(az storage account show --name "$account" --resource-group "$rg" --query id -o tsv)" \
        --output none 2>/dev/null || true
    az storage container create --name tfstate --account-name "$account" --auth-mode login \
        --output none || { echo "Role assignment still propagating: wait a minute and rerun."; exit 1; }
    printf 'resource_group_name  = "%s"\nstorage_account_name = "%s"\n' "$rg" "$account" > infra/backend.hcl
    cd infra && ARM_SUBSCRIPTION_ID=$sub terraform init -input=false -backend-config=backend.hcl

# Run Terraform against Azure, e.g. `just infra plan -out=x.tfplan`, `just infra apply x.tfplan`
infra *args:
    #!/usr/bin/env bash
    set -euo pipefail
    export ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
    cd infra && terraform {{args}}

# Store an app secret in Key Vault from a hidden prompt (database-url, anthropic-api-key, ...)
secret name:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{name}}" in
        database-url|anthropic-api-key|openai-api-key|gemini-api-key) ;;
        *) echo "Unknown secret '{{name}}'" >&2; exit 1 ;;
    esac
    vault=$(cd infra && terraform output -raw key_vault_name)
    read -rsp "Value for {{name}} (hidden): " value; echo
    [ -n "$value" ] || { echo "Empty value, nothing stored." >&2; exit 1; }
    # Piped, not passed as an argument (other processes can see arguments), with no newline
    printf '%s' "$value" | az keyvault secret set --vault-name "$vault" --name "{{name}}" \
        --file /dev/stdin --output none
    echo "Stored a new version of {{name}} in $vault."
