import { render, screen } from '@testing-library/react-native';
import App from './App';

// App opens a WebSocket on mount. Replace the global with an inert stub so the test never
// touches the network; the connecting placeholder is what renders before any message.
class StubWebSocket {
  static instances: StubWebSocket[] = [];
  readonly url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    StubWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  StubWebSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', {
    value: StubWebSocket,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: originalWebSocket,
    configurable: true,
    writable: true,
  });
});

test('renders the connecting placeholder before any snapshot arrives', () => {
  const { unmount } = render(<App />);

  expect(screen.getByText('connecting…')).toBeTruthy();
  expect(screen.getByText('—')).toBeTruthy();
  expect(StubWebSocket.instances).toHaveLength(1);

  unmount();
  expect(StubWebSocket.instances[0]?.closed).toBe(true);
});
