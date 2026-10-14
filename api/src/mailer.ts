/** Sends one email. The outbox worker calls it; nothing else sends mail. */
export interface Mailer {
  /** "sent" if it went out, "logged" if this mailer only records mail (local and the demo). */
  send(message: { to: string; subject: string; text: string }): Promise<'sent' | 'logged'>
}

/** Local development and the public demo: emails are kept in the outbox and logged, not sent. */
export class LogMailer implements Mailer {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(message: { to: string; subject: string }): Promise<'logged'> {
    this.log(`email (not sent) to ${message.to}: ${message.subject}`)
    return 'logged'
  }
}

/**
 * Azure Communication Services Email, signed in with the app's managed identity (or a
 * developer's Azure login locally), so no email key is stored anywhere.
 */
export class AcsMailer implements Mailer {
  private client: Promise<import('@azure/communication-email').EmailClient> | null = null

  constructor(
    private readonly endpoint: string,
    private readonly from: string,
  ) {}

  private getClient() {
    this.client ??= (async () => {
      const { EmailClient } = await import('@azure/communication-email')
      const { DefaultAzureCredential } = await import('@azure/identity')
      return new EmailClient(this.endpoint, new DefaultAzureCredential())
    })()
    return this.client
  }

  async send(message: { to: string; subject: string; text: string }): Promise<'sent'> {
    const client = await this.getClient()
    const address = this.from.match(/<(.+)>/)?.[1] ?? this.from
    const poller = await client.beginSend({
      senderAddress: address,
      recipients: { to: [{ address: message.to }] },
      content: { subject: message.subject, plainText: message.text },
    })
    const result = await poller.pollUntilDone()
    if (result.status !== 'Succeeded') {
      throw new Error(`Azure Communication Services: ${result.status} ${result.error?.message ?? ''}`)
    }
    return 'sent'
  }
}
