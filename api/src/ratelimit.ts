/** At most `limit` events per key in a sliding hour, kept in memory. */
export class HourlyLimit {
  private readonly events = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record an event and return true, or return false if the key is over its limit. */
  take(key: string): boolean {
    const cutoff = this.now() - 3600_000
    const recent = (this.events.get(key) ?? []).filter((t) => t > cutoff)
    if (recent.length >= this.limit) {
      this.events.set(key, recent)
      return false
    }
    recent.push(this.now())
    this.events.set(key, recent)
    return true
  }
}
