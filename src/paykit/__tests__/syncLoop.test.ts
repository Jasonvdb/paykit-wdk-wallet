// The sync loop's lifecycle: stop() must win over a round that is still
// running, so a disposed service never keeps a timer alive.
import { AppState } from 'react-native';

import { SyncEventLog } from '../eventLog';
import { PaykitSyncLoop, type SyncLoopDeps } from '../syncLoop';

jest.mock('@synonymdev/react-native-paykit', () => ({
  FfiLinkedPeerState: { NotLinked: 0, Linking: 1, Linked: 2, RecoveryRequired: 3, Blocked: 4 },
  PaykitFfiError: { instanceOf: () => false },
  PaykitFfiError_Tags: {},
}));

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };
function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PaykitSyncLoop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });
  afterEach(() => jest.useRealTimers());

  it('stays stopped when stop() runs during a round', async () => {
    const snapshot = deferred();
    const calls: string[] = [];
    const deps: SyncLoopDeps = {
      call: async <T,>(label: string) => {
        calls.push(label);
        if (label === 'privateMessageSchedulingSnapshot') return (await snapshot.promise) as T;
        throw new Error('Paykit is disconnected');
      },
      contactKeys: () => [],
      log: new SyncEventLog(),
      onRoundComplete: async () => undefined,
    };
    const loop = new PaykitSyncLoop(deps);
    loop.start();
    expect(loop.getStatus().phase).toBe('syncing');

    loop.stop();
    snapshot.resolve({ linkedPeers: [], pendingOutboundCounterparties: [] });
    await jest.runAllTimersAsync();

    expect(loop.getStatus().phase).toBe('stopped');
    expect(jest.getTimerCount()).toBe(0);
    // No second round was started.
    expect(calls.filter((c) => c === 'privateMessageSchedulingSnapshot')).toHaveLength(1);
  });
});
