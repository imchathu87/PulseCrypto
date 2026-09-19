import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  MarketBatchMessageSchema,
  type PairSnapshot,
} from '@pulsecrypto/contracts';

export default function App() {
  const [pair, setPair] = useState<PairSnapshot | null>(null);

  useEffect(() => {
    const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
    const ws = new WebSocket(`ws://${host}:8080/ws`);
    ws.onmessage = (event) => {
      const batch = MarketBatchMessageSchema.parse(JSON.parse(event.data));
      setPair(batch.pairs[0] ?? null);
    };
    return () => ws.close();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.pair}>{pair?.pair ?? 'connecting…'}</Text>
      <Text style={styles.price}>
        {pair?.price != null ? pair.price.toFixed(2) : '—'}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pair: { fontSize: 24, color: '#666' },
  price: { fontSize: 64, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
});
