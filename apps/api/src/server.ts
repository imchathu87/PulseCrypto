import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { MarketSnapshotSchema, type MarketSnapshot } from '@pulsecrypto/contracts';

const BINANCE_URL =
  'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms/btcusdt@ticker';

const app = Fastify({ logger: true });
await app.register(websocket);

app.get('/health', async () => ({ ok: true }));

app.get('/ws', { websocket: true }, () => {});

const seenStreams = new Set<string>();
const upstream = new WebSocket(BINANCE_URL);

upstream.onmessage = (event) => {
  const { stream, data } = JSON.parse(event.data);

  if (!seenStreams.has(stream)) {
    seenStreams.add(stream);
    console.log(`[binance] first message on ${stream}`);
    console.log('  wrapper keys:', Object.keys({ stream, data }));
    console.log('  data keys:   ', Object.keys(data));
    console.log('  raw data:    ', JSON.stringify(data));
  }

  // Depth payload has no symbol or event time, so only the ticker maps to a snapshot.
  if (stream !== 'btcusdt@ticker') return;

  const snapshot: MarketSnapshot = MarketSnapshotSchema.parse({
    pair: data.s,
    price: Number(data.c),
    lastUpdated: data.E,
  });
  const message = JSON.stringify(snapshot);
  for (const client of app.websocketServer.clients) client.send(message);
};

await app.listen({ host: '0.0.0.0', port: 8080 });
