// Can the wallet afford this send? And what went wrong, in plain words.
//
// The Send screen checks twice: before asking WDK for a fee (is the amount
// within the balance?) and after (does the fee fit too?). USD₮ is an
// ERC-20 token, so its network fee is paid in ETH: a wallet can hold plenty
// of USD₮ and still be unable to send it. That case gets its own message,
// "Not enough ETH for gas", because it is the one people do not expect.
//
// Pure functions, unit tested. Messages follow docs/DESIGN.md "Writing":
// say what happened and what to do, never an SDK error code.
import { formatAssetAmount } from './amounts';
import { ASSETS, feeAssetFor, type AssetId } from './assets';

export type SendProblem = {
  kind: 'amount' | 'balance' | 'gas';
  message: string;
};

type Balances = Partial<Record<AssetId, bigint>>;

function have(value: bigint | undefined, asset: AssetId): string {
  return formatAssetAmount(value ?? 0n, asset, { withSymbol: true });
}

/**
 * Check a send against the balances. Pass `fee` once WDK has quoted it.
 * Returns the first problem, or undefined if the send fits.
 */
export function checkAffordable(input: { asset: AssetId; amount: bigint; balances: Balances; fee?: bigint }): SendProblem | undefined {
  const { asset, amount, balances, fee } = input;
  const symbol = ASSETS[asset].symbol;
  if (amount <= 0n) return { kind: 'amount', message: 'Enter an amount above zero.' };

  const balance = balances[asset];
  if (balance !== undefined && amount > balance) {
    return { kind: 'balance', message: `Not enough ${symbol}. You have ${have(balance, asset)}.` };
  }

  const feeAsset = feeAssetFor(asset);
  if (feeAsset === asset) {
    // BTC pays its own fee: amount and fee come out of the same balance.
    if (fee !== undefined && balance !== undefined && amount + fee > balance) {
      return {
        kind: 'balance',
        message: `Not enough ${symbol} for this amount plus the ${formatFee(fee, asset)} network fee. You have ${have(balance, asset)}. Try Max.`,
      };
    }
    return undefined;
  }

  // A token transfer: the fee is paid in the chain's native coin (ETH).
  const gas = balances[feeAsset];
  if (gas !== undefined && (gas === 0n || (fee !== undefined && gas < fee))) {
    const detail =
      fee !== undefined
        ? `The network fee is ${formatFee(fee, feeAsset)} and you have ${formatFee(gas, feeAsset)}.`
        : `You have ${formatFee(gas, feeAsset)}.`;
    return { kind: 'gas', message: `Not enough ETH for gas. ${detail} Send a little Sepolia ETH to your USD₮ address.` };
  }
  return undefined;
}

/**
 * A network fee for display. Sepolia fees are often far below what the
 * normal ETH precision shows, and "0 ETH" would be wrong, so tiny fees say
 * "less than 0.000001 ETH". BTC fees read better in sats.
 */
export function formatFee(fee: bigint, asset: AssetId): string {
  if (asset === 'btc') return `${fee.toLocaleString('en-US')} ${fee === 1n ? 'sat' : 'sats'}`;
  const text = formatAssetAmount(fee, asset, { withSymbol: true });
  // formatAssetAmount shows ETH to 6 decimals, so anything smaller reads "0".
  if (fee > 0n && !/[1-9]/.test(text)) return `less than 0.000001 ${ASSETS[asset].symbol}`;
  return text;
}

/**
 * Turn an error from WDK (thrown in its worklet, carried over RPC as a
 * message) into words for the Send screen. The raw message is matched,
 * never shown. Use it for steps that never broadcast (fee quote, Max);
 * after a send, use sendFailureFor.
 */
export function sendErrorMessage(error: unknown, asset: AssetId): string {
  return knownSendError(rawMessage(error), asset) ?? (NETWORK_ERROR.test(rawMessage(error)) ? NETWORK_MESSAGE : PREPARE_MESSAGE);
}

/**
 * Why a send (or a faucet mint, or a collect) failed, and whether it may
 * have gone out anyway.
 *
 *   'not-sent'  WDK refused before broadcasting (dust, balance, checksum,
 *               fee cap, a reverting call): safe to fix and try again.
 *   'unknown'   anything else, network errors included. WDK's BTC send
 *               broadcasts first and then polls Electrum for the new
 *               outputs, so a timeout there arrives after the transaction
 *               left; an EVM RPC timeout on eth_sendRawTransaction is just as
 *               unclear. Trying again could pay twice (on EVM a retry signs
 *               a new transaction with the next nonce), so the screen stops
 *               and sends the person to Activity instead.
 */
export type SendFailure = { outcome: 'not-sent' | 'unknown'; message: string };

export const MAY_HAVE_BEEN_SENT =
  "This may have been sent. Check Activity in a minute before you try again, so you don't pay twice.";

export function sendFailureFor(error: unknown, asset: AssetId): SendFailure {
  const known = knownSendError(rawMessage(error), asset);
  return known ? { outcome: 'not-sent', message: known } : { outcome: 'unknown', message: MAY_HAVE_BEEN_SENT };
}

const NETWORK_ERROR = /timeout|timed out|network|fetch|ECONN|socket/i;
const NETWORK_MESSAGE = "Couldn't reach the network. Check the connection and try again.";
const PREPARE_MESSAGE = 'The wallet could not prepare this transaction. Check the address and amount, then try again.';

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

/** Errors WDK (or useSend's own checks) raise before anything is broadcast. */
function knownSendError(raw: string, asset: AssetId): string | undefined {
  const symbol = ASSETS[asset].symbol;
  const afterFees = /after fees must be bigger than the dust limit \(= ?(\d+)\)/i.exec(raw);
  if (afterFees) {
    return `That amount is too small: after the network fee, less than ${BigInt(afterFees[1] ?? '0') + 1n} sats would arrive. Send more.`;
  }
  const dust = /dust limit \(= ?(\d+)\)/i.exec(raw);
  if (dust) return `That amount is too small to send. Send at least ${BigInt(dust[1] ?? '0') + 1n} sats.`;
  if (/no unspent outputs|insufficient balance/i.test(raw)) return `Not enough ${symbol} for this amount plus the network fee.`;
  if (/insufficient funds/i.test(raw)) return asset === 'usdt' ? 'Not enough ETH for gas.' : `Not enough ${symbol} for this amount plus the network fee.`;
  if (/transfer amount exceeds balance|exceeds balance/i.test(raw)) return `Not enough ${symbol}.`;
  if (/bad address checksum/i.test(raw)) return 'That address has a typo: its capital letters do not match its checksum. Copy it again.';
  if (/maximum fee/i.test(raw)) return 'The network fee is higher than this wallet allows right now. Try again later.';
  if (/execution reverted|CALL_EXCEPTION/i.test(raw)) return 'The network refused this transaction. Check the amount and your balance, then try again.';
  if (/not ready yet|contract address|not a testnet Bitcoin address|not an Ethereum address|amount above zero/i.test(raw)) return PREPARE_MESSAGE;
  return undefined;
}
