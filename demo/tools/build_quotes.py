"""Build the fictional vendor quotes in demo/quotes/.

    uv run --no-project --with reportlab python demo/tools/build_quotes.py

Most match a seeded request exactly. A few don't, on purpose, for the AI quote check: a total
that differs from the request, an expired quote, and a quote from a different vendor.
"""

from dataclasses import dataclass, field
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parents[1] / "quotes"
styles = getSampleStyleSheet()


@dataclass
class Quote:
    file: str
    vendor: str
    address: str
    number: str
    date: str
    valid_until: str
    lines: list[tuple[str, int, float]]  # description, quantity, unit price (USD)
    notes: list[str] = field(default_factory=list)
    tax_rate: float = 0.0


QUOTES = [
    Quote("northwind_displays_quote.pdf", "Northwind Displays", "410 Harbor Way, Portland, OR",
          "NWD-24817", "2 October 2026", "1 December 2026",
          [("27-inch 4K monitor, USB-C", 2, 389.00), ("Dual monitor arm", 1, 62.00)],
          ["Delivery included within the continental US."]),
    Quote("canvasly_quote.pdf", "Canvasly", "88 Market Street, San Francisco, CA",
          "CV-Q-1093", "28 September 2026", "28 October 2026",
          [("Canvasly Team plan, per seat, annual", 8, 300.00)],
          ["Billed annually in advance. Seats can be added at the same rate."]),
    Quote("cloudconf_2026_quote.pdf", "CloudConf 2026", "Conference Center, Austin, TX",
          "CC26-5521", "15 September 2026", "31 October 2026",
          [("Full conference pass", 1, 790.00), ("Partner hotel, per night", 2, 180.00)],
          ["Hotel rate held until 31 October 2026."]),
    Quote("ergo_works_quote.pdf", "Ergo Works", "12 Mill Road, Denver, CO",
          "EW-7702", "6 October 2026", "6 November 2026",
          [("Height-adjustable desk, 160 x 80 cm", 1, 610.00), ("Cable tray", 1, 40.00)]),
    Quote("harvest_table_catering_quote.pdf", "Harvest Table Catering", "300 Orchard Ave, Boise, ID",
          "HT-2026-118", "1 October 2026", "15 November 2026",
          [("Lunch, per person per day", 28, 50.00), ("Dinner, per person", 14, 120.00),
           ("Service and delivery", 1, 120.00)],
          ["Two days, 14 guests. Dietary requirements by 7 days before the event."]),
    Quote("ledgerpro_quote.pdf", "LedgerPro", "1 Ledger Plaza, Chicago, IL",
          "LP-88310", "20 September 2026", "20 December 2026",
          [("Multi-entity consolidation module, annual", 1, 5000.00)]),
    Quote("keycraft_quote.pdf", "KeyCraft", "57 Elm Street, Raleigh, NC",
          "KC-3309", "10 October 2026", "10 November 2026",
          [("Mechanical keyboard, tactile switches", 1, 165.00), ("Wrist rest", 1, 15.00)]),
    Quote("contoso_docks_quote.pdf", "Contoso Supplies", "900 Commerce Drive, Columbus, OH",
          "CS-Q-4410", "12 October 2026", "30 November 2026",
          [("USB-C docking station", 4, 215.00)]),
    # For the AI check: these disagree with a request on purpose
    Quote("mismatch_contoso_docks_wrong_total.pdf", "Contoso Supplies",
          "900 Commerce Drive, Columbus, OH", "CS-Q-4415", "12 October 2026", "30 November 2026",
          [("USB-C docking station", 5, 215.00)],
          ["Five units. Use with a request for four docks at $860 to see a mismatch."]),
    Quote("mismatch_ergo_works_expired.pdf", "Ergo Works", "12 Mill Road, Denver, CO",
          "EW-6120", "2 July 2026", "2 August 2026",
          [("Height-adjustable desk, 160 x 80 cm", 1, 610.00), ("Cable tray", 1, 40.00)],
          ["An older quote that has expired. Use with the standing desk request."]),
    Quote("mismatch_wrong_vendor_monitors.pdf", "Fabrikam Electronics",
          "77 Circuit Lane, San Jose, CA", "FE-30018", "3 October 2026", "3 December 2026",
          [("27-inch 4K monitor", 2, 420.00)],
          ["From a different vendor than the monitors request names."]),
]


def money(value: float) -> str:
    return f"${value:,.2f}"


def build(quote: Quote) -> None:
    doc = SimpleDocTemplate(str(OUT / quote.file), pagesize=LETTER,
                            title=f"{quote.vendor} quote {quote.number}",
                            author=f"{quote.vendor} (fictional)")
    subtotal = sum(q * p for _, q, p in quote.lines)
    tax = round(subtotal * quote.tax_rate, 2)
    rows = [["Description", "Qty", "Unit price", "Amount"]]
    rows += [[d, str(q), money(p), money(q * p)] for d, q, p in quote.lines]
    rows += [["", "", "Subtotal", money(subtotal)]]
    if tax:
        rows += [["", "", f"Tax ({quote.tax_rate:.0%})", money(tax)]]
    rows += [["", "", "Total (USD)", money(subtotal + tax)]]
    table = Table(rows, colWidths=[3.4 * inch, 0.6 * inch, 1.2 * inch, 1.2 * inch], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey),
        ("LINEABOVE", (2, len(quote.lines) + 1), (-1, len(quote.lines) + 1), 0.5, colors.grey),
    ]))
    story = [
        Paragraph(quote.vendor, styles["Title"]),
        Paragraph(quote.address, styles["Normal"]),
        Spacer(1, 16),
        Paragraph(f"<b>Quote</b> {quote.number}", styles["Heading2"]),
        Paragraph(f"Date: {quote.date}<br/>Valid until: <b>{quote.valid_until}</b>"
                  "<br/>Prepared for: Example Co. purchasing", styles["Normal"]),
        Spacer(1, 16),
        table,
        Spacer(1, 16),
        *[Paragraph(note, styles["Normal"]) for note in quote.notes],
        Spacer(1, 24),
        Paragraph("<i>A fictional quote created for the FlowApprove demo. The vendor, prices and "
                  "details are invented.</i>", styles["Normal"]),
    ]
    doc.build(story)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for quote in QUOTES:
        build(quote)
    print(f"Wrote {len(QUOTES)} quotes to {OUT}")
