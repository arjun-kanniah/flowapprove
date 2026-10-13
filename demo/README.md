# Demo quotes

Fictional vendor quotes for trying FlowApprove. Every vendor, price and detail is invented.
`just seed` attaches the matching quote to each seeded request; the rest are for you to attach.

## Matching quotes

| File | Total | Matches |
|---|---|---|
| `northwind_displays_quote.pdf` | $840.00 | Monitors for the design review room (seeded with it) |
| `canvasly_quote.pdf` | $2,400.00 | Design tool seats, annual plan (seeded with it) |
| `cloudconf_2026_quote.pdf` | $1,150.00 | Conference ticket and travel (seeded with it) |
| `harvest_table_catering_quote.pdf` | $3,200.00 | Team offsite catering (seeded with it) |
| `ledgerpro_quote.pdf` | $5,000.00 | Accounting software add-on (seeded with it) |
| `ergo_works_quote.pdf` | $650.00 | Standing desk: Mo asked Sam for the quote, so sign in as Sam, attach it and resubmit |
| `keycraft_quote.pdf` | $180.00 | Rita's mechanical keyboard draft |
| `contoso_docks_quote.pdf` | $860.00 | A new request: 4 USB-C docking stations from Contoso Supplies, $860 |

## Quotes that don't match (for the AI quote check)

| File | What's wrong |
|---|---|
| `mismatch_contoso_docks_wrong_total.pdf` | Five docks for $1,075.00, against a request for four at $860 |
| `mismatch_ergo_works_expired.pdf` | The right desk and price, but the quote expired on 2 August 2026 |
| `mismatch_wrong_vendor_monitors.pdf` | Monitors from Fabrikam Electronics, not Northwind Displays as the request says |

`tools/build_quotes.py` rebuilds them all:

```bash
uv run --no-project --with reportlab python demo/tools/build_quotes.py
```
