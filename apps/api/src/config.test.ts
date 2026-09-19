import { describe, expect, it } from 'vitest';
import { DEFAULT_PAIRS, DEFAULT_SIMULATOR_RATE, loadConfig } from './config.ts';

describe('config loadConfig', () => {
  it('loads default configuration when env is empty', () => {
    const config = loadConfig({});
    expect(config.PAIRS).toEqual(DEFAULT_PAIRS);
    expect(config.MARKET_SOURCE).toBe('binance');
    expect(config.SIMULATOR_RATE).toBe(DEFAULT_SIMULATOR_RATE);
  });

  it('parses valid custom config with trimmed pairs and simulator source', () => {
    const config = loadConfig({
      PAIRS: ' BTCUSDT , ETHUSDT ',
      MARKET_SOURCE: 'simulator',
      SIMULATOR_RATE: '200', // 2 pairs * 10 = 20 => 200 is multiple, k = 10 >= 2
    });
    expect(config.PAIRS).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(config.MARKET_SOURCE).toBe('simulator');
    expect(config.SIMULATOR_RATE).toBe(200);
  });

  describe('I/O edge cases and bad config validation', () => {
    it('throws with error naming SIMULATOR_RATE when SIMULATOR_RATE is non-numeric', () => {
      expect(() =>
        loadConfig({
          SIMULATOR_RATE: 'abc',
        }),
      ).toThrow(/SIMULATOR_RATE/);
    });

    it('throws with error naming SIMULATOR_RATE when rate is not positive', () => {
      expect(() =>
        loadConfig({
          SIMULATOR_RATE: '0',
        }),
      ).toThrow(/SIMULATOR_RATE/);

      expect(() =>
        loadConfig({
          SIMULATOR_RATE: '-100',
        }),
      ).toThrow(/SIMULATOR_RATE/);
    });

    it('throws with error naming PAIRS when pair format is invalid (e.g. lowercase)', () => {
      expect(() =>
        loadConfig({
          PAIRS: 'btcusdt',
        }),
      ).toThrow(/PAIRS/);
    });

    it('throws with error naming PAIRS when duplicate pairs are provided', () => {
      expect(() =>
        loadConfig({
          PAIRS: 'BTCUSDT,ETHUSDT,BTCUSDT',
        }),
      ).toThrow(/PAIRS/);
    });

    it('throws with error naming MARKET_SOURCE when source is unknown', () => {
      expect(() =>
        loadConfig({
          MARKET_SOURCE: 'kraken',
        }),
      ).toThrow(/MARKET_SOURCE/);
    });

    it('throws with error naming SIMULATOR_RATE when rate is not an integer multiple of 10 × pairs.length', () => {
      expect(() =>
        loadConfig({
          MARKET_SOURCE: 'simulator',
          SIMULATOR_RATE: '75', // default 5 pairs * 10 = 50, 75 % 50 !== 0
        }),
      ).toThrow(/SIMULATOR_RATE/);
    });

    it('throws with error naming SIMULATOR_RATE when k < 2', () => {
      expect(() =>
        loadConfig({
          MARKET_SOURCE: 'simulator',
          SIMULATOR_RATE: '50', // 50 / 50 = 1 < 2
        }),
      ).toThrow(/SIMULATOR_RATE/);
    });
  });
});
