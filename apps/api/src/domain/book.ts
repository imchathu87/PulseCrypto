import type { OrderBookLevel } from './market-event.ts';

/**
 * Validates an order book.
 * A book is valid iff:
 * - every price and quantity is finite and > 0
 * - bids are strictly descending in price
 * - asks are strictly ascending in price
 * - bestBid < bestAsk when both sides exist
 * - an empty side (or both empty) is valid
 */
export function isValidBook(
  bids: readonly OrderBookLevel[],
  asks: readonly OrderBookLevel[],
): boolean {
  for (let i = 0; i < bids.length; i++) {
    const [price, qty] = bids[i]!;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
      return false;
    }
    if (i > 0 && !(bids[i - 1]![0] > price)) {
      return false;
    }
  }

  for (let i = 0; i < asks.length; i++) {
    const [price, qty] = asks[i]!;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) {
      return false;
    }
    if (i > 0 && !(asks[i - 1]![0] < price)) {
      return false;
    }
  }

  if (bids.length > 0 && asks.length > 0) {
    if (!(bids[0]![0] < asks[0]![0])) {
      return false;
    }
  }

  return true;
}
