// Phase 0 spike: one screen that proves the native stack end to end.
// Throwaway UI; Phase 1 replaces it. Reusable pieces live in src/config and
// src/paykit.
//
// Never show or log the mnemonic, the signup code or Paykit records with
// payloads that could hold secrets. Public keys and addresses are fine.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccount, useWalletManager, useWdkApp } from '@tetherto/wdk-react-native-core';
import {
  FfiLinkedPeerState,
  FfiPubkyIdentityCapability,
  FfiPublicPaymentEndpointLoadFailureKind,
  FfiPublicPaymentResolutionStatus,
  FfiPublicationStatus,
  FfiProfileSource,
  normalizePubkyPublicKey,
} from '@synonymdev/react-native-paykit';

import { demoPrefill } from '../config/demo';
import { BTC, BTC_NETWORK, ETH, EVM_NETWORK, USDT } from '../config/wdk';
import { PAYKIT_APP_NAME } from '../config/paykit';
import { createPaykitClient, type PaykitClient } from '../paykit/client';
import { describeError } from '../paykit/session';

const WALLET_ID = 'paykit-wdk-demo';
const LINK_POLL_MS = 3000;
const LINK_MAX_ROUNDS = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function formatUnits(raw: string | null | undefined, decimals: number): string {
  if (raw == null) return '?';
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function SpikeScreen() {
  const { state } = useWdkApp();
  const walletManager = useWalletManager();
  const btcAccount = useAccount({ network: BTC_NETWORK, accountIndex: 0 });
  const evmAccount = useAccount({ network: EVM_NETWORK, accountIndex: 0 });

  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ btc?: string; eth?: string; usdt?: string }>({});
  const [ownPubky, setOwnPubky] = useState<string>('');
  const [peerInput, setPeerInput] = useState(demoPrefill.peerPubky ?? '');
  const [linkState, setLinkState] = useState<string>('-');

  // The mnemonic lives only in memory and only to derive the Pubky key.
  const mnemonicRef = useRef<string | null>(null);
  const paykitRef = useRef<PaykitClient | null>(null);

  const log = useCallback((line: string) => {
    const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
    console.log(`[spike] ${line}`);
    setLines((prev) => [stamped, ...prev].slice(0, 200));
  }, []);

  useEffect(() => {
    log(`WDK state: ${state.status}${state.status === 'ERROR' ? ` (${state.error.message})` : ''}`);
  }, [state, log]);

  const run = useCallback(
    async (name: string, task: () => Promise<void>) => {
      if (busy) return;
      setBusy(name);
      const started = Date.now();
      try {
        await task();
        log(`${name}: ok (${Date.now() - started} ms)`);
      } catch (error) {
        log(`${name}: FAILED ${describeError(error)}`);
      } finally {
        setBusy(null);
      }
    },
    [busy, log],
  );

  // (1) WDK ---------------------------------------------------------------

  const initWallet = () =>
    run('init wallet', async () => {
      if (walletManager.status === 'UNLOCKED') {
        log('wallet already unlocked');
      } else if (demoPrefill.mnemonic) {
        try {
          await walletManager.restoreWallet(demoPrefill.mnemonic, WALLET_ID);
          log('restored wallet from dev prefill');
        } catch (error) {
          if (!String((error as Error).message).includes('already exists')) throw error;
          await walletManager.unlock(WALLET_ID);
          log('unlocked existing wallet');
        }
      } else {
        try {
          await walletManager.unlock(WALLET_ID);
          log('unlocked existing wallet');
        } catch {
          await walletManager.createWallet(WALLET_ID);
          log('created a new wallet (WDK-generated mnemonic)');
        }
      }
      mnemonicRef.current = demoPrefill.mnemonic ?? (await walletManager.getMnemonic(WALLET_ID));
      log(`mnemonic loaded (${mnemonicRef.current?.split(' ').length ?? 0} words)`);
    });

  const generateCheck = () =>
    run('WDK generateMnemonic', async () => {
      const phrase = await walletManager.generateMnemonic(12);
      log(`generated a fresh mnemonic in the worklet (${phrase.split(' ').length} words, discarded)`);
    });

  const refreshBalances = () =>
    run('balances', async () => {
      const [btc] = await btcAccount.getBalance([BTC]);
      log(`BTC balance: ${btc?.success ? `${btc.balance} sats` : `error ${btc?.error}`}`);
      const [eth, usdt] = await evmAccount.getBalance([ETH, USDT]);
      log(`ETH balance: ${eth?.success ? `${eth.balance} wei` : `error ${eth?.error}`}`);
      log(`USDT balance: ${usdt?.success ? `${usdt.balance} units` : `error ${usdt?.error}`}`);
      setBalances({
        btc: btc?.success ? formatUnits(btc.balance, 8) : 'error',
        eth: eth?.success ? formatUnits(eth.balance, 18) : 'error',
        usdt: usdt?.success ? formatUnits(usdt.balance, 6) : 'error',
      });
    });

  useEffect(() => {
    if (btcAccount.address) log(`BTC address: ${btcAccount.address}`);
  }, [btcAccount.address, log]);
  useEffect(() => {
    if (evmAccount.address) log(`EVM address: ${evmAccount.address}`);
  }, [evmAccount.address, log]);

  // (2) Paykit onboarding ---------------------------------------------------

  const onboardPaykit = () =>
    run('paykit onboarding', async () => {
      const mnemonic = mnemonicRef.current;
      if (!mnemonic) throw new Error('init the wallet first');
      if (!btcAccount.address || !evmAccount.address) throw new Error('addresses not loaded yet');
      const client =
        paykitRef.current ??
        (await createPaykitClient({
          mnemonic,
          signupCode: demoPrefill.signupCode,
          addresses: { btc: btcAccount.address, evm: evmAccount.address },
          log,
        }));
      paykitRef.current = client;
      setOwnPubky(client.publicKey);
      log(`pubky session via ${client.how}: ${client.publicKey}`);
      console.log(`[spike] OWN_PUBKY ${client.publicKey}`);
      const status = await client.sdk.initialize();
      log(`initialize: capability ${FfiPubkyIdentityCapability[status.capability]}`);
      await client.sdk.publishPaykitNoiseKeyAuthorization();
      log('published Paykit noise key authorization');
      const registry = await client.sdk.publishPaykitApp(PAYKIT_APP_NAME, {
        privatePayments: true,
        paymentRequests: true,
        receipts: true,
        outgoingPayments: true,
      });
      log(`published app registry: ${registry.apps.map((a) => a.appId).join(', ')}`);
    });

  // (3) Public endpoints ----------------------------------------------------

  const publishEndpoints = () =>
    run('publish endpoints', async () => {
      const client = paykitRef.current;
      if (!client) throw new Error('onboard Paykit first');
      client.adapter.setAddresses({ btc: btcAccount.address ?? undefined, evm: evmAccount.address ?? undefined });
      const report = await client.sdk.syncPublicEndpoints();
      const fmt = (c: { identifier: string; status: FfiPublicationStatus; error?: string }) =>
        `${c.identifier}=${FfiPublicationStatus[c.status]}${c.error ? ` (${c.error})` : ''}`;
      log(
        `endpoints: published [${report.published.map(fmt).join(', ')}] removed [${report.removed
          .map(fmt)
          .join(', ')}] failed [${report.failed.map(fmt).join(', ')}]`,
      );
    });

  // (4) Peer ----------------------------------------------------------------

  const peerKey = (): string => {
    const client = paykitRef.current;
    if (!client) throw new Error('onboard Paykit first');
    const peer = normalizePubkyPublicKey(peerInput.trim());
    if (peer === client.publicKey) throw new Error('that is your own pubky');
    return peer;
  };

  const resolvePeer = () =>
    run('resolve peer', async () => {
      const client = paykitRef.current!;
      const peer = peerKey();
      log(`resolving ${peer}`);
      const registry = await client.sdk.paykitAppRegistry(peer);
      log(
        registry
          ? `peer registry: apps [${registry.apps.map((a) => a.appId).join(', ')}], noise key ${
              registry.noisePublicKey ? 'present' : 'missing'
            }`
          : 'peer registry: none',
      );
      const resolution = await client.sdk.resolvePublicContactPayment(peer, undefined);
      log(`peer public payment: ${FfiPublicPaymentResolutionStatus[resolution.status]}`);
      for (const endpoint of resolution.payableEndpoints) {
        // Public endpoint payloads are public addresses.
        log(`  ${endpoint.appId}/${endpoint.identifier}: ${endpoint.payload.exportText()}`);
      }
      for (const failure of resolution.failures) {
        log(`  failure: ${failure.appId} ${FfiPublicPaymentEndpointLoadFailureKind[failure.kind]} ${failure.context}`);
      }
      const profile = await client.sdk.resolveProfile(peer, true);
      log(
        profile
          ? `peer profile: source ${FfiProfileSource[profile.source]}, name ${profile.displayName ?? '(none)'}`
          : 'peer profile: none',
      );
    });

  const linkPeer = () =>
    run('link peer', async () => {
      const client = paykitRef.current!;
      const peer = peerKey();
      await client.sdk.saveContact({ publicKey: peer, label: 'spike peer' });
      log('saved contact; linking');
      for (let round = 1; round <= LINK_MAX_ROUNDS; round++) {
        try {
          const report = await client.sdk.ensureLinkWithPeer(peer, 1);
          const name = FfiLinkedPeerState[report.state];
          setLinkState(name);
          log(`round ${round}: link ${name}`);
          if (report.state === FfiLinkedPeerState.Linked) return;
        } catch (error) {
          log(`round ${round}: ensureLink ${describeError(error)}`);
        }
        try {
          const sent = await client.sdk.processOutboundPrivateMessages(peer);
          if (sent.attempted.length) log(`  outbound: sent ${sent.sent.length}/${sent.attempted.length}`);
        } catch (error) {
          log(`  outbound: ${describeError(error)}`);
        }
        try {
          const received = await client.sdk.receivePrivateMessages(peer);
          if (received.streamItemIds.length) log(`  inbound: ${received.streamItemIds.length} items`);
        } catch (error) {
          log(`  inbound: ${describeError(error)}`);
        }
        await sleep(LINK_POLL_MS);
      }
      throw new Error('not linked yet; press again to keep trying');
    });

  const linkedPeers = () =>
    run('linked peers', async () => {
      const client = paykitRef.current;
      if (!client) throw new Error('onboard Paykit first');
      const peers = await client.sdk.linkedPeers();
      for (const p of peers) log(`  ${p.counterparty}: ${FfiLinkedPeerState[p.state]}`);
      if (!peers.length) log('  no linked peers');
    });

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Paykit x WDK spike ({Platform.OS})</Text>
        <Text style={styles.meta}>WDK: {state.status} / wallet: {walletManager.status}</Text>
        <Text style={styles.meta}>Prefill: {demoPrefill.mnemonic ? 'mnemonic' : 'no mnemonic'}, {demoPrefill.signupCode ? 'signup code' : 'no code'}</Text>

        <Section title="1. Wallet (WDK)">
          <Button label="Init wallet" onPress={initWallet} busy={busy} testID="btn-init-wallet" />
          <Button label="Refresh balances" onPress={refreshBalances} busy={busy} testID="btn-balances" />
          <Button label="Generate mnemonic (check)" onPress={generateCheck} busy={busy} testID="btn-generate" />
          <Field label="BTC (Mutinynet)" value={btcAccount.address ?? '-'} />
          <Field label="BTC balance" value={balances.btc ?? '-'} />
          <Field label="EVM (Sepolia)" value={evmAccount.address ?? '-'} />
          <Field label="ETH balance" value={balances.eth ?? '-'} />
          <Field label="USDT balance" value={balances.usdt ?? '-'} />
        </Section>

        <Section title="2. Paykit identity">
          <Button label="Sign in / up + publish app" onPress={onboardPaykit} busy={busy} testID="btn-onboard" />
          <Field label="Own pubky" value={ownPubky || '-'} testID="own-pubky" />
        </Section>

        <Section title="3. Public endpoints">
          <Button label="Publish BTC + USDT endpoints" onPress={publishEndpoints} busy={busy} testID="btn-publish" />
        </Section>

        <Section title="4. Peer">
          <TextInput
            style={styles.input}
            value={peerInput}
            onChangeText={setPeerInput}
            placeholder="peer pubky"
            autoCapitalize="none"
            autoCorrect={false}
            testID="peer-input"
          />
          <Button label="Resolve peer" onPress={resolvePeer} busy={busy} testID="btn-resolve" />
          <Button label="Add contact + link" onPress={linkPeer} busy={busy} testID="btn-link" />
          <Button label="Linked peers" onPress={linkedPeers} busy={busy} testID="btn-linked" />
          <Field label="Link state" value={linkState} testID="link-state" />
        </Section>

        <Section title={`Log${busy ? ` (running: ${busy})` : ''}`}>
          {busy ? <ActivityIndicator /> : null}
          {lines.map((line, i) => (
            <Text key={i} style={styles.log} selectable>
              {line}
            </Text>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Button(props: { label: string; onPress: () => void; busy: string | null; testID?: string }) {
  const disabled = props.busy !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      testID={props.testID}
      onPress={props.onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

function Field({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f7f9' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  meta: { fontSize: 12, color: '#555' },
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 12, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '600' },
  button: { backgroundColor: '#1f6feb', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  field: { gap: 2 },
  fieldLabel: { fontSize: 11, color: '#666' },
  fieldValue: { fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  log: { fontSize: 10, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
