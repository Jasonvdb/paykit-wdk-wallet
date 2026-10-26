// Sending BTC, USD₮ or ETH from the spending account (index 0).
//
// Two steps, both through WDK's worklet:
//   quote(): ask WDK for the network fee (BTC: quoteSendTransaction with the
//            Electrum fee estimate; USD₮: quoteTransfer, an ERC-20 transfer;
//            ETH: quoteSendTransaction).
//   send():  sign and broadcast. WDK's `send` maps a native asset to
//            sendTransaction and a token to `transfer`.
// The keys never leave the worklet; this code only sees addresses, amounts
// and the resulting hash. Amounts are bigint base units end to end.
import { useCallback, useMemo } from 'react';
import { useAccount, type IAsset } from '@tetherto/wdk-react-native-core';

import { BTC, BTC_NETWORK, ETH, EVM_NETWORK, USDT } from '../config/wdk';
import { isAddressForChain } from './addressFormat';
import { parseBaseUnits } from './amounts';
import { ASSETS, feeAssetFor, type AssetId } from './assets';
import { transactionUrl } from './explorers';
import { recordSentTransaction } from './sentTransactions';

export type SendRequest = {
  asset: AssetId;
  /** A tb1... address for BTC, a 0x... address for USD₮ and ETH. */
  to: string;
  /** Base units of `asset`. */
  amount: bigint;
};

export type FeeQuote = { fee: bigint; feeAsset: AssetId };

export type SendResult = { hash: string; fee?: bigint; explorerUrl: string };

const WDK_ASSETS: Record<AssetId, IAsset> = { btc: BTC, usdt: USDT, eth: ETH };

function checkRequest(request: SendRequest): void {
  const chain = ASSETS[request.asset].chain;
  if (!isAddressForChain(request.to, chain)) {
    throw new Error(chain === 'bitcoin' ? 'That is not a testnet Bitcoin address (tb1…).' : 'That is not an Ethereum address (0x…).');
  }
  if (request.amount <= 0n) throw new Error('Enter an amount above zero.');
}

export function useSend() {
  const btcAccount = useAccount({ network: BTC_NETWORK, accountIndex: 0 });
  const evmAccount = useAccount({ network: EVM_NETWORK, accountIndex: 0 });

  const accountFor = useCallback(
    (asset: AssetId) => (ASSETS[asset].chain === 'bitcoin' ? btcAccount : evmAccount),
    [btcAccount, evmAccount],
  );

  const quote = useCallback(
    async (request: SendRequest): Promise<FeeQuote> => {
      checkRequest(request);
      const result = await accountFor(request.asset).estimateFee({
        to: request.to.trim(),
        asset: WDK_ASSETS[request.asset],
        amount: request.amount.toString(),
      });
      const fee = parseBaseUnits(String(result.fee));
      if (!result.success || fee === undefined) throw new Error(result.error ?? 'Could not estimate the network fee.');
      return { fee, feeAsset: feeAssetFor(request.asset) };
    },
    [accountFor],
  );

  const send = useCallback(
    async (request: SendRequest): Promise<SendResult> => {
      checkRequest(request);
      const chain = ASSETS[request.asset].chain;
      const result = await accountFor(request.asset).send({
        to: request.to.trim(),
        asset: WDK_ASSETS[request.asset],
        amount: request.amount.toString(),
      });
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
        counterpartyAddress: request.to.trim(),
        timestamp: Date.now(),
        status: 'pending',
        accountIndex: 0,
      });
      return { hash: result.hash, fee, explorerUrl: transactionUrl(chain, result.hash) };
    },
    [accountFor],
  );

  return useMemo(() => ({ quote, send }), [quote, send]);
}
