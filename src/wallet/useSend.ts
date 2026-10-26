// Sending BTC, USD₮ or ETH from the spending account (index 0).
//
// Two steps, both through WDK's worklet:
//   quote(): ask WDK for the network fee (BTC: quoteSendTransaction; USD₮:
//            quoteTransfer, an ERC-20 transfer whose fee is paid in ETH;
//            ETH: quoteSendTransaction).
//   send():  sign and broadcast. WDK's `send` maps a native asset to
//            sendTransaction and a token to `transfer`.
// The keys never leave the worklet; this code only sees addresses, amounts
// and the resulting hash. Amounts are bigint base units end to end.
//
// BTC fee rate: WDK estimates a rate itself but never reports it, so the
// quote fetches Mutinynet's recommended rate (./mutinynet.ts) and passes it
// to WDK explicitly. The review shows that rate, and send() must be given
// the quote's `feeRate` so the transaction pays what the person approved.
// If the rate API is down, WDK estimates as before and no rate is shown.
import { useCallback, useMemo } from 'react';
import { useAccount, type IAsset } from '@tetherto/wdk-react-native-core';

import { BTC, BTC_NETWORK, ETH, EVM_NETWORK, USDT } from '../config/wdk';
import { isAddressForChain } from './addressFormat';
import { parseBaseUnits } from './amounts';
import { ASSETS, feeAssetFor, type AssetId } from './assets';
import { transactionUrl } from './explorers';
import { fetchBtcFeeRate } from './mutinynet';
import { recordSentTransaction } from './sentTransactions';

export type SendRequest = {
  asset: AssetId;
  /** A tb1... address for BTC, a 0x... address for USD₮ and ETH. */
  to: string;
  /** Base units of `asset`. */
  amount: bigint;
  /** BTC only: sats per vbyte, from the quote. Omitted, WDK estimates its own. */
  feeRate?: bigint;
};

export type FeeQuote = {
  /** Base units of `feeAsset`. */
  fee: bigint;
  feeAsset: AssetId;
  /** BTC only: the sats/vB rate the fee was quoted at. Pass it on to send(). */
  feeRate?: bigint;
};

export type SendResult = { hash: string; fee?: bigint; explorerUrl: string };

const WDK_ASSETS: Record<AssetId, IAsset> = { btc: BTC, usdt: USDT, eth: ETH };

/** WDK BTC account methods this file calls through `extension()` (all in wdk.config.js allowedMethods). */
type BtcAccountExtension = {
  quoteSendTransaction: (tx: { to: string; value: string; feeRate: number }) => Promise<{ fee: string }>;
  sendTransaction: (tx: { to: string; value: string; feeRate: number }) => Promise<{ hash: string; fee: string }>;
  getMaxSpendable: (options: { feeRate?: number }) => Promise<{ amount: string; fee: string; changeValue: string }>;
};

function checkRequest(request: SendRequest): void {
  const chain = ASSETS[request.asset].chain;
  if (!isAddressForChain(request.to, chain)) {
    throw new Error(chain === 'bitcoin' ? 'That is not a testnet Bitcoin address (tb1…).' : 'That is not an Ethereum address (0x…).');
  }
  if (request.amount <= 0n) throw new Error('Enter an amount above zero.');
}

export function useSend() {
  const btcAccount = useAccount<BtcAccountExtension>({ network: BTC_NETWORK, accountIndex: 0 });
  const evmAccount = useAccount({ network: EVM_NETWORK, accountIndex: 0 });

  const accountFor = useCallback(
    (asset: AssetId) => (ASSETS[asset].chain === 'bitcoin' ? btcAccount : evmAccount),
    [btcAccount, evmAccount],
  );

  const quote = useCallback(
    async (request: SendRequest): Promise<FeeQuote> => {
      checkRequest(request);
      if (request.asset === 'btc') {
        const feeRate = await fetchBtcFeeRate().catch(() => undefined);
        if (feeRate !== undefined) {
          const result = await btcAccount.extension().quoteSendTransaction({
            to: request.to.trim(),
            value: request.amount.toString(),
            feeRate: Number(feeRate),
          });
          const fee = parseBaseUnits(String(result?.fee));
          if (fee === undefined) throw new Error('Could not estimate the network fee.');
          return { fee, feeAsset: 'btc', feeRate };
        }
      }
      const result = await accountFor(request.asset).estimateFee({
        to: request.to.trim(),
        asset: WDK_ASSETS[request.asset],
        amount: request.amount.toString(),
      });
      const fee = parseBaseUnits(String(result.fee));
      if (!result.success || fee === undefined) throw new Error(result.error ?? 'Could not estimate the network fee.');
      return { fee, feeAsset: feeAssetFor(request.asset) };
    },
    [accountFor, btcAccount],
  );

  /**
   * The most BTC account 0 can send in one transaction at `feeRate`, after
   * the fee. WDK's getMaxSpendable keeps a dust-sized change output back
   * when it can, so this is slightly below the balance.
   */
  const maxBtcAmount = useCallback(
    async (feeRate?: bigint): Promise<bigint> => {
      const result = await btcAccount.extension().getMaxSpendable(feeRate !== undefined ? { feeRate: Number(feeRate) } : {});
      return parseBaseUnits(String(result?.amount ?? '')) ?? 0n;
    },
    [btcAccount],
  );

  const send = useCallback(
    async (request: SendRequest): Promise<SendResult> => {
      checkRequest(request);
      const chain = ASSETS[request.asset].chain;
      const to = request.to.trim();
      const value = request.amount.toString();
      let result: { success: boolean; hash?: string; fee?: string; error?: string };
      if (request.asset === 'btc' && request.feeRate !== undefined) {
        // The rate the person approved on the review step (see the header).
        const sent = await btcAccount.extension().sendTransaction({ to, value, feeRate: Number(request.feeRate) });
        result = { success: !!sent?.hash, ...sent };
      } else {
        result = await accountFor(request.asset).send({ to, asset: WDK_ASSETS[request.asset], amount: value });
      }
      if (!result.success || !result.hash) throw new Error(result.error ?? 'The transaction was not sent.');
      const fee = parseBaseUnits(String(result.fee));
      recordSentTransaction({
        id: `${chain}:${result.hash}:local:${request.asset}`,
        chain,
        asset: request.asset,
        direction: 'out',
        amount: request.amount,
        fee,
        hash: result.hash,
        counterpartyAddress: to,
        timestamp: Date.now(),
        status: 'pending',
        accountIndex: 0,
      });
      return { hash: result.hash, fee, explorerUrl: transactionUrl(chain, result.hash) };
    },
    [accountFor, btcAccount],
  );

  return useMemo(() => ({ quote, send, maxBtcAmount }), [quote, send, maxBtcAmount]);
}
