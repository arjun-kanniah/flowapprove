import { describe, expect, it } from 'vitest'
import { parseChoice } from './models.js'

describe('parseChoice', () => {
  it('accepts provider/model, or the model alone', () => {
    expect(parseChoice('gemini/gemini-3.5-flash-lite')).toEqual({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
    })
    expect(parseChoice('gemini-3.5-flash-lite')).toEqual({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
    })
    expect(parseChoice(' claude-haiku-5-5 ')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    })
  })

  it('rejects models outside the allowlist, or under the wrong provider', () => {
    expect(() => parseChoice('gpt-4')).toThrow(/isn't offered/)
    expect(() => parseChoice('openai/claude-haiku-5-5')).toThrow(/isn't offered/)
  })
})
