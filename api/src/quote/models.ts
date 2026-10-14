import { QuoteExtraction } from './schema.js'

/**
 * The models the quote check may use, by provider. A deployment picks one with
 * QUOTE_CHECK_MODEL (e.g. "anthropic/claude-haiku-5-5"); only these are accepted.
 */
export const CATALOG = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  openai: ['gpt-6-luna', 'gpt-6.1-sol'],
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
} as const

export type Provider = keyof typeof CATALOG

export interface ModelChoice {
  provider: Provider
  model: string
}

export interface Extraction {
  result: QuoteExtraction
  inputTokens: number
  outputTokens: number
}

/** Reads a quote. Each provider's official SDK, each returning the same validated shape. */
export type Extractor = (system: string, prompt: string) => Promise<Extraction>

export class QuoteCheckError extends Error {}

/**
 * Read QUOTE_CHECK_MODEL: "provider/model", or just the model name, since every name in the
 * catalog belongs to one provider.
 */
export function parseChoice(value: string): ModelChoice {
  const spec = value.trim()
  const [first, second] = spec.split('/') as [string, string | undefined]
  const entries = Object.entries(CATALOG) as [Provider, readonly string[]][]
  const match = second
    ? entries.find(([provider, models]) => provider === first && models.includes(second))
    : entries.find(([, models]) => models.includes(first))
  if (!match) {
    const all = entries.flatMap(([p, ms]) => ms.map((m) => `${p}/${m}`))
    throw new Error(`QUOTE_CHECK_MODEL "${spec}" isn't offered. Choose one of: ${all.join(', ')}`)
  }
  return { provider: match[0], model: second ?? first }
}

/** Keep only what the schema allows, whichever provider produced it. */
function validate(raw: unknown): QuoteExtraction {
  const parsed = QuoteExtraction.safeParse(raw)
  if (!parsed.success) throw new QuoteCheckError('The model’s answer didn’t match the expected format.')
  return parsed.data
}

export async function makeExtractor(choice: ModelChoice, apiKey: string): Promise<Extractor> {
  // SDKs load on first use, so the API starts quickly
  switch (choice.provider) {
    case 'anthropic': {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod')
      const client = new Anthropic({ apiKey })
      return async (system, prompt) => {
        const response = await client.messages.parse({
          model: choice.model,
          max_tokens: 8000,
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: zodOutputFormat(QuoteExtraction), effort: 'low' },
        })
        if (response.stop_reason === 'refusal') {
          throw new QuoteCheckError('The model declined to read this quote.')
        }
        return {
          result: validate(response.parsed_output),
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      }
    }
    case 'openai': {
      const { default: OpenAI } = await import('openai')
      const { zodTextFormat } = await import('openai/helpers/zod')
      const client = new OpenAI({ apiKey })
      return async (system, prompt) => {
        const response = await client.responses.parse({
          model: choice.model,
          instructions: system,
          input: prompt,
          store: false, // don't keep quote contents on OpenAI's side
          text: { format: zodTextFormat(QuoteExtraction, 'quote_extraction') },
        })
        return {
          result: validate(response.output_parsed),
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        }
      }
    }
    case 'gemini': {
      const { GoogleGenAI } = await import('@google/genai')
      const { z } = await import('zod')
      const client = new GoogleGenAI({ apiKey })
      const schema = z.toJSONSchema(QuoteExtraction)
      return async (system, prompt) => {
        const response = await client.models.generateContent({
          model: choice.model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
          },
        })
        let raw: unknown
        try {
          raw = JSON.parse(response.text ?? '')
        } catch {
          throw new QuoteCheckError('The model’s answer wasn’t valid JSON.')
        }
        return {
          result: validate(raw),
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens:
            (response.usageMetadata?.candidatesTokenCount ?? 0) +
            (response.usageMetadata?.thoughtsTokenCount ?? 0),
        }
      }
    }
  }
}
