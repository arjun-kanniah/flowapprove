import { z } from 'zod'

/**
 * What the model reads off a quote. It only extracts and judges the line items; the
 * comparisons that decide the verdict (total, date, vendor) are done in code (compare.ts).
 */
export const QuoteExtraction = z.object({
  readable: z
    .boolean()
    .describe('False if the text is not a vendor quote or too garbled to read.'),
  vendor: z.string().nullable().describe('The company issuing the quote, as written.'),
  quoteNumber: z.string().nullable(),
  currency: z.string().nullable().describe('ISO code such as USD, if stated or clear.'),
  total: z.number().nullable().describe('The final total payable, as a number.'),
  validUntil: z
    .string()
    .nullable()
    .describe('The date the quote is valid until, as YYYY-MM-DD, if stated.'),
  items: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().nullable(),
        amount: z.number().nullable().describe('The line amount (quantity × unit price).'),
      }),
    )
    .describe('The line items, in order.'),
  itemsMatchRequest: z
    .enum(['yes', 'no', 'unclear'])
    .describe('Whether the items are what the request describes.'),
  itemsNote: z.string().describe('One sentence explaining the items judgement.'),
})

export type QuoteExtraction = z.infer<typeof QuoteExtraction>
