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
  /** Public demo: persona sign-in and nightly-reset data instead of Entra ID. */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

export type Config = z.infer<typeof Env> & { financeThresholdCents: number }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env)
  return { ...parsed, financeThresholdCents: Math.round(parsed.APPROVAL_FINANCE_THRESHOLD * 100) }
}
