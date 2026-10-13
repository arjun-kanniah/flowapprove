-- CreateEnum
CREATE TYPE "Role" AS ENUM ('requester', 'manager', 'finance', 'admin');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('draft', 'pending_manager', 'pending_finance', 'changes_requested', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "Step" AS ENUM ('manager', 'finance');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('approve', 'reject', 'request_changes');

-- CreateEnum
CREATE TYPE "AiCheckStatus" AS ENUM ('running', 'done', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" "Role"[],
    "manager_id" UUID,
    "entra_object_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "vendor" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" "Status" NOT NULL DEFAULT 'draft',
    "requester_id" UUID NOT NULL,
    "manager_id" UUID,
    "manager_approver_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "submitted_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step" "Step" NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "actor_id" UUID NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "request_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "Status",
    "to_status" "Status",
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_checks" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiCheckStatus" NOT NULL DEFAULT 'running',
    "verdict" TEXT,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_entra_object_id_key" ON "users"("entra_object_id");

-- CreateIndex
CREATE INDEX "purchase_requests_requester_id_created_at_idx" ON "purchase_requests"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_requests_manager_id_status_idx" ON "purchase_requests"("manager_id", "status");

-- CreateIndex
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_request_id_idx" ON "attachments"("request_id");

-- CreateIndex
CREATE INDEX "decisions_request_id_created_at_idx" ON "decisions"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_request_id_created_at_idx" ON "audit_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- CreateIndex
CREATE INDEX "ai_checks_request_id_created_at_idx" ON "ai_checks"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_checks" ADD CONSTRAINT "ai_checks_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_checks" ADD CONSTRAINT "ai_checks_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit log is append-only: the database itself refuses to change or remove history,
-- whatever the application code does.
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_or_delete
    BEFORE UPDATE OR DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON "audit_events"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
