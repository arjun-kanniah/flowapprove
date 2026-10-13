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

# Apply migrations to the local database
migrate: db
    cd api && npx prisma migrate deploy

# Create a migration after changing api/prisma/schema.prisma, e.g. `just migration add_x`
migration name: db
    cd api && npx prisma migrate dev --name {{name}}

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
