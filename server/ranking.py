from decimal import Decimal


def rank_between(prev: Decimal | None, next: Decimal | None) -> Decimal:
    if prev is None and next is None:
        return Decimal(1)
    if prev is None:
        return next / 2
    if next is None:
        return prev + 1
    return (prev + next) / 2
