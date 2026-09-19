import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINANCE_WS_URL,
  DEFAULT_PAIRS,
  DEFAULT_SIMULATOR_RATE,
  DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS,
  DEFAULT_UPSTREAM_SILENCE_MS,
  loadConfig,
} from './config.ts';

describe('config loadConfig', () => {
  it('loads default configuration when env is empty', () => {
    const config = loadConfig({});
    expect(config.PAIRS).toEqual(DEFAULT_PAIRS);
    expect(config.MARKET_SOURCE).toBe('binance');
    expect(config.SIMULATOR_RATE).toBe(DEFAULT_SIMULATOR_RATE);
    expect(config.BINANCE_WS_URL).toBe(DEFAULT_BINANCE_WS_URL);
    expect(config.UPSTREAM_SILENCE_MS).toBe(DEFAULT_UPSTREAM_SILENCE_MS);
    expect(config.UPSTREAM_CONNECT_TIMEOUT_MS).toBe(DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS);
  });

  it('parses valid custom config with trimmed pairs and simulator source', () => {
    const config = loadConfig({
      PAIRS: ' BTCUSDT , ETHUSDT ',
      MARKET_SOURCE: 'simulator',
      SIMULATOR_RATE: '200', // 2 pairs * 10 = 20 => 200 is multiple, k = 10 >= 2
      BINANCE_WS_URL: 'wss://data-stream.binance.vision',
      UPSTREAM_SILENCE_MS: '15000',
      UPSTREAM_CONNECT_TIMEOUT_MS: '5000',
    });
    expect(config.PAIRS).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(config.MARKET_SOURCE).toBe('simulator');
    expect(config.SIMULATOR_RATE).toBe(200);
    expect(config.BINANCE_WS_URL).toBe('wss://data-stream.binance.vision');
    expect(config.UPSTREAM_SILENCE_MS).toBe(15000);
    expect(config.UPSTREAM_CONNECT_TIMEOUT_MS).toBe(5000);
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

    it('throws with error naming BINANCE_WS_URL when url is invalid', () => {
      expect(() =>
        loadConfig({
          BINANCE_WS_URL: 'not-a-url',
        }),
      ).toThrow(/BINANCE_WS_URL/);
    });

    it('throws with error naming BINANCE_WS_URL when url protocol is not ws: or wss:', () => {
      expect(() =>
        loadConfig({
          BINANCE_WS_URL: 'http://stream.binance.com:9443',
        }),
      ).toThrow(/BINANCE_WS_URL/);

      expect(() =>
        loadConfig({
          BINANCE_WS_URL: 'https://stream.binance.com:9443',
        }),
      ).toThrow(/BINANCE_WS_URL/);
    });

    it('throws with error naming UPSTREAM_SILENCE_MS when non-numeric or non-positive', () => {
      expect(() =>
        loadConfig({
          UPSTREAM_SILENCE_MS: 'abc',
        }),
      ).toThrow(/UPSTREAM_SILENCE_MS/);

      expect(() =>
        loadConfig({
          UPSTREAM_SILENCE_MS: '0',
        }),
      ).toThrow(/UPSTREAM_SILENCE_MS/);

      expect(() =>
        loadConfig({
          UPSTREAM_SILENCE_MS: '-1000',
        }),
      ).toThrow(/UPSTREAM_SILENCE_MS/);
    });

    it('throws with error naming UPSTREAM_CONNECT_TIMEOUT_MS when non-numeric or non-positive', () => {
      expect(() =>
        loadConfig({
          UPSTREAM_CONNECT_TIMEOUT_MS: 'abc',
        }),
      ).toThrow(/UPSTREAM_CONNECT_TIMEOUT_MS/);

      expect(() =>
        loadConfig({
          UPSTREAM_CONNECT_TIMEOUT_MS: '0',
        }),
      ).toThrow(/UPSTREAM_CONNECT_TIMEOUT_MS/);

      expect(() =>
        loadConfig({
          UPSTREAM_CONNECT_TIMEOUT_MS: '-1000',
        }),
      ).toThrow(/UPSTREAM_CONNECT_TIMEOUT_MS/);
    });
  });
});
