import { describe, expect, it } from 'vitest';
import { isValidBook } from './book.ts';
import type { OrderBookLevel } from './market-event.ts';

describe('domain/book isValidBook', () => {
  it('accepts a valid book with strictly descending bids, strictly ascending asks, and bestBid < bestAsk', () => {
    const bids: OrderBookLevel[] = [
      [100, 1],
      [99, 2],
      [98, 3],
    ];
    const asks: OrderBookLevel[] = [
      [101, 1],
      [102, 2],
      [103, 3],
    ];
    expect(isValidBook(bids, asks)).toBe(true);
  });

  it('accepts empty book sides', () => {
    expect(isValidBook([], [])).toBe(true);
    expect(isValidBook([[100, 1]], [])).toBe(true);
    expect(isValidBook([], [[101, 1]])).toBe(true);
  });

  it('rejects bids that are not strictly descending', () => {
    // Equal prices
    expect(
      isValidBook(
        [
          [100, 1],
          [100, 2],
        ],
        [[101, 1]],
      ),
    ).toBe(false);

    // Ascending bids
    expect(
      isValidBook(
        [
          [99, 1],
          [100, 2],
        ],
        [[101, 1]],
      ),
    ).toBe(false);
  });

  it('rejects asks that are not strictly ascending', () => {
    // Equal prices
    expect(
      isValidBook(
        [[100, 1]],
        [
          [101, 1],
          [101, 2],
        ],
      ),
    ).toBe(false);

    // Descending asks
    expect(
      isValidBook(
        [[100, 1]],
        [
          [102, 1],
          [101, 2],
        ],
      ),
    ).toBe(false);
  });

  it('rejects crossed and locked books where bestBid >= bestAsk', () => {
    // Locked: bestBid === bestAsk
    expect(isValidBook([[100, 1]], [[100, 1]])).toBe(false);

    // Crossed: bestBid > bestAsk
    expect(isValidBook([[102, 1]], [[100, 1]])).toBe(false);
  });

  it('rejects books with non-positive or non-finite prices or quantities', () => {
    expect(isValidBook([[0, 1]], [[100, 1]])).toBe(false);
    expect(isValidBook([[-10, 1]], [[100, 1]])).toBe(false);
    expect(isValidBook([[NaN, 1]], [[100, 1]])).toBe(false);
    expect(isValidBook([[Infinity, 1]], [[100, 1]])).toBe(false);

    expect(isValidBook([[100, 0]], [[101, 1]])).toBe(false);
    expect(isValidBook([[100, -1]], [[101, 1]])).toBe(false);
    expect(isValidBook([[100, NaN]], [[101, 1]])).toBe(false);
    expect(isValidBook([[100, Infinity]], [[101, 1]])).toBe(false);

    expect(isValidBook([[100, 1]], [[0, 1]])).toBe(false);
    expect(isValidBook([[100, 1]], [[101, 0]])).toBe(false);
  });
});
