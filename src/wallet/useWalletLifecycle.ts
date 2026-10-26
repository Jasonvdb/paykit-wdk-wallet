// The wallet's lifecycle on top of WDK's React Native hooks: create,
// restore, unlock, and read the mnemonic.
//
// WDK keeps one encrypted seed per wallet id in the Keychain/Keystore and
// runs the wallet in a Bare worklet. This app manages exactly one wallet
// (WALLET_ID). The same BIP-39 mnemonic also derives the Pubky identity for
// Paykit (PaykitService.connect in src/paykit/PaykitService.ts), so "one recovery phrase restores
// both" — testnet only, because the two key uses are not domain-separated.
//
// Never log or render the mnemonic outside the explicit "reveal" screen.
import { useCallback, useMemo } from 'react';
import { createSecureStorage, useWalletManager, useWdkApp, validateMnemonic } from '@tetherto/wdk-react-native-core';

import { WALLET_ID } from '../config/wdk';

export type WalletStatus =
  /** The WDK worklet is starting (or restarting). */
  | 'starting'
  /** No wallet on this device: onboarding must create or restore one. */
  | 'no-wallet'
  /** A wallet exists but is not loaded into the worklet yet. */
  | 'locked'
  /** Unlocked and ready for balances, addresses and sends. */
  | 'ready'
  | 'error';

export type WalletLifecycle = {
  status: WalletStatus;
  /** Safe-to-show error text when status is 'error'. */
  error?: string;
  createWallet: () => Promise<void>;
  /** Restore from a phrase. Replaces a wallet that exists but was never finished onboarding. */
  restoreWallet: (mnemonic: string) => Promise<void>;
  unlock: () => Promise<void>;
  /** The phrase, for deriving the Pubky identity or the reveal screen. Keep it out of state and logs. */
  getMnemonic: () => Promise<string>;
  /** True if `text` looks like a BIP-39 phrase (12 or 24 words; WDK and Paykit verify the checksum). */
  isValidMnemonic: (text: string) => boolean;
  /**
   * True if the Keychain/Keystore holds an encrypted seed for WALLET_ID.
   * WDK's wallet list lives in a separate MMKV file and can be empty while
   * the seed still exists (e.g. after an app data migration), so the launch
   * gate checks the seed itself.
   */
  hasStoredWallet: () => Promise<boolean>;
};

function hasStoredWallet(): Promise<boolean> {
  return createSecureStorage().hasWallet(WALLET_ID);
}

/** Normalize how people paste phrases: lowercase, single spaces. */
export function normalizeMnemonic(text: string): string {
  return text.trim().toLowerCase().split(/\s+/).join(' ');
}

export function useWalletLifecycle(): WalletLifecycle {
  const { state } = useWdkApp();
  const manager = useWalletManager();

  const status: WalletStatus = (() => {
    switch (state.status) {
      case 'READY':
        return 'ready';
      case 'NO_WALLET':
        return 'no-wallet';
      case 'LOCKED':
        return 'locked';
      case 'ERROR':
        return 'error';
      default:
        return 'starting';
    }
  })();

  const createWallet = useCallback(async () => {
    await manager.createWallet(WALLET_ID);
  }, [manager]);

  const restoreWallet = useCallback(
    async (mnemonic: string) => {
      const phrase = normalizeMnemonic(mnemonic);
      if (!validateMnemonic(phrase)) throw new Error('A recovery phrase has 12 or 24 words.');
      // Onboarding only: a wallet left over from an unfinished onboarding is
      // replaced. WDK refuses to restore over an existing id otherwise.
      if (manager.status === 'UNLOCKED') await manager.lock();
      if (await hasStoredWallet()) await manager.deleteWallet(WALLET_ID);
      await manager.restoreWallet(phrase, WALLET_ID);
    },
    [manager],
  );

  const unlock = useCallback(async () => {
    await manager.unlock(WALLET_ID);
  }, [manager]);

  const getMnemonic = useCallback(async () => {
    const phrase = await manager.getMnemonic(WALLET_ID);
    if (!phrase) throw new Error('No recovery phrase stored for this wallet');
    return phrase;
  }, [manager]);

  const isValidMnemonic = useCallback((text: string) => validateMnemonic(normalizeMnemonic(text)), []);

  return useMemo(
    () => ({
      status,
      error: state.status === 'ERROR' ? state.error.message : undefined,
      createWallet,
      restoreWallet,
      unlock,
      getMnemonic,
      isValidMnemonic,
      hasStoredWallet,
    }),
    [status, state, createWallet, restoreWallet, unlock, getMnemonic, isValidMnemonic],
  );
}
