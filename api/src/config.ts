import { z } from 'zod'

/** Runtime configuration from environment variables, validated once at startup. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z
    .string()
    .default('postgresql://flowapprove:flowapprove@localhost:5433/flowapprove'),
  /** Dollars; requests at or above it also need finance approval. */
  APPROVAL_FINANCE_THRESHOLD: z.coerce.number().positive().default(1000),
  /** How people sign in: demo personas (local and the public demo) or Entra ID. */
  AUTH_MODE: z.enum(['demo', 'entra']).default('demo'),
  /** Public demo: shows a banner and resets its data nightly. */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Signs the session cookie. Required outside development. */
  SESSION_SECRET: z.string().min(32).optional(),
  /** Where attachments go in development. */
  STORAGE_DIR: z.string().default('.data/attachments'),
  /** Blob Storage for attachments in Azure, e.g. https://<account>.blob.core.windows.net */
  AZURE_STORAGE_ACCOUNT_URL: z.string().default(''),
  AZURE_STORAGE_CONTAINER: z.string().default('attachments'),
  /** The built web app, served by the API in production (one origin for the app and Socket.IO). */
  STATIC_DIR: z.string().optional(),
  /** The model that reads quotes, as provider/model; the check is off without its key. */
  QUOTE_CHECK_MODEL: z.string().default('anthropic/claude-haiku-5-5'),
  /** Checks each person may run in an hour (automatic checks on submit included). */
  QUOTE_CHECKS_PER_HOUR: z.coerce.number().int().positive().default(10),
  /** The web app's address, for links in emails. */
  APP_URL: z.string().url().default('http://localhost:5174'),
  /** log: record and log emails without sending (local, demo); acs: Azure Communication Services. */
  EMAIL_DELIVERY: z.enum(['log', 'acs']).default('log'),
  /** Sender address (a verified Azure Communication Services domain) and the ACS endpoint. */
  EMAIL_FROM: z.string().default('FlowApprove <noreply@example.com>'),
  ACS_ENDPOINT: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
})

export type Config = z.infer<typeof Env> & { SESSION_SECRET: string; financeThresholdCents: number }

const DEV_SESSION_SECRET = 'dev-only-session-secret-not-for-production'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env)
  if (parsed.NODE_ENV === 'production' && !parsed.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production.')
  }
  return {
    ...parsed,
    SESSION_SECRET: parsed.SESSION_SECRET ?? DEV_SESSION_SECRET,
    financeThresholdCents: Math.round(parsed.APPROVAL_FINANCE_THRESHOLD * 100),
  }
}
