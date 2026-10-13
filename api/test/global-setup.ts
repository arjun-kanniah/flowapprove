import { execFileSync } from 'node:child_process'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string
  }
}

/**
 * Tests run against their own database next to the development one, created and migrated here,
 * so running them never touches your local data.
 */
export default async function setup(project: TestProject) {
  const devUrl = new URL(
    process.env.DATABASE_URL ?? 'postgresql://flowapprove:flowapprove@localhost:5433/flowapprove',
  )
  const testUrl = new URL(devUrl)
  testUrl.pathname = '/flowapprove_test'

  const client = new pg.Client({ connectionString: devUrl.toString() })
  await client.connect()
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'flowapprove_test'")
  if (exists.rowCount === 0) await client.query('CREATE DATABASE flowapprove_test')
  await client.end()

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  })
  project.provide('testDatabaseUrl', testUrl.toString())
}
