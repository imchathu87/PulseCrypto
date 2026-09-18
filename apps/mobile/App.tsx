import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { MarketSnapshotSchema, type MarketSnapshot } from '@pulsecrypto/contracts';

export default function App() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);

  useEffect(() => {
    const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
    const ws = new WebSocket(`ws://${host}:8080/ws`);
    ws.onmessage = (event) => setSnapshot(MarketSnapshotSchema.parse(JSON.parse(event.data)));
    return () => ws.close();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.pair}>{snapshot?.pair ?? 'connecting…'}</Text>
      <Text style={styles.price}>{snapshot ? snapshot.price.toFixed(2) : '—'}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pair: { fontSize: 24, color: '#666' },
  price: { fontSize: 64, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
});
