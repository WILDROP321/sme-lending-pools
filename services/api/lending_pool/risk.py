"""Versioned, explainable demo underwriting; scores are not default probabilities."""
from decimal import Decimal, ROUND_HALF_UP

MODEL_VERSION = 'invoice-v1'
TIERS = (
    dict(id='core', name='Core Income', ceiling=3, base_cents=120_000_000, loss_scenario=2),
    dict(id='balanced', name='Balanced Growth', ceiling=7, base_cents=85_000_000, loss_scenario=6),
    dict(id='opportunity', name='Opportunity', ceiling=15, base_cents=45_000_000, loss_scenario=12),
)


def classify(score):
    return next((tier['id'] for tier in TIERS if 0 <= score <= tier['ceiling']), None)


def rounded_cents(value):
    return int(Decimal(str(value)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def assess(amount_cents, invoice_cents, days, years_trading, late_payment_pct):
    """Inputs are validated at the boundary; enforce eligibility for all callers."""
    if not (0 < amount_cents <= invoice_cents and amount_cents * 100 <= invoice_cents * 85):
        raise ValueError('Advance must be positive and at most 85% of invoice value.')
    if not (1 <= days <= 180 and 0 <= years_trading <= 100 and 0 <= late_payment_pct <= 100):
        raise ValueError('Invoice term or business history is outside supported limits.')
    ratio = amount_cents / invoice_cents
    factors = [
        dict(name='Invoice maturity', points=round(3 * days / 180, 4), detail=f'{days} days until payment'),
        dict(name='Advance ratio', points=round(3 * (ratio / .85) ** 2, 4), detail=f'{ratio * 100:.1f}% of invoice value'),
        dict(name='Debtor payment history', points=round(5 * late_payment_pct / 100, 4), detail=f'{late_payment_pct:g}% of debtor invoices paid late'),
        dict(name='Business track record', points=round(3 * (1 - min(years_trading, 10) / 10), 4), detail=f'{years_trading:g} years trading'),
    ]
    score = round(.5 + sum(factor['points'] for factor in factors), 2)
    apr = round(6 + score * 1.2, 2)
    interest = rounded_cents(Decimal(amount_cents) * Decimal(str(apr)) / 100 * days / 365)
    return dict(version=MODEL_VERSION, score=score, pool=classify(score), factors=factors,
                base_score=.5, apr=apr, term_days=days, interest_cents=interest,
                repayment_cents=amount_cents + interest)


# The same model evaluates fixtures and submitted companies. Dates are relative only
# for these clearly labeled demo fixtures, which are not historical performance data.
SAMPLES = (
    ('Harbor Foods', 'Food & beverage', 'Pay growers before supermarket invoices settle', 180000, 300000, 30, 12, 0),
    ('Northline Logistics', 'Logistics', 'Cover fuel and driver payroll before freight settlement', 140000, 240000, 45, 10, 1),
    ('Cedar Medical', 'Healthcare', 'Purchase supplies while hospital invoices clear', 210000, 380000, 60, 14, 0),
    ('Forma Packaging', 'Manufacturing', 'Buy raw materials for a confirmed retail order', 160000, 220000, 60, 6, 5),
    ('Solstice Solar', 'Energy', 'Pay installation crews ahead of commercial settlement', 190000, 260000, 75, 5, 10),
    ('Atelier Supply', 'Wholesale', 'Finance seasonal inventory against distributor invoices', 120000, 170000, 90, 4, 12),
    ('Loop Electronics', 'Electronics', 'Purchase components before export payment', 130000, 180000, 105, 2, 35),
    ('Bloom Studio', 'Creative services', 'Cover production payroll before agency settlement', 85000, 120000, 120, 1, 40),
    ('Frontier Textiles', 'Textiles', 'Bridge retailer receivables for the next production run', 110000, 150000, 150, 1, 55),
)
