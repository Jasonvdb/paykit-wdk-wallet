// The wallet service: everything the UI needs from WDK, in one import.
//
//   UI -> these hooks/helpers -> @tetherto/wdk-react-native-core -> WDK in a Bare worklet
//
// Hooks must be used inside <WdkAppProvider> (src/App.tsx). Amounts are
// bigint base units everywhere; format them with ./amounts.ts.
export { ASSETS, feeAssetFor, type AssetId, type AssetInfo, type Chain } from './assets';
export {
  formatAssetAmount,
  formatUnits,
  fromPaykitDecimal,
  parseAssetAmount,
  parseBaseUnits,
  parseUnits,
  toPaykitDecimal,
  type ParseResult,
} from './amounts';
export { chainOfAddress, isAddressForChain, isBtcTestnetAddress, isEvmAddress } from './addressFormat';
export { addressUrl, transactionUrl } from './explorers';
export { type ActivityItem, type ActivityStatus } from './activity';
export { DEFAULT_FAUCET_MINT_UNITS } from './faucet';

export { normalizeMnemonic, useWalletLifecycle, type WalletLifecycle, type WalletStatus } from './useWalletLifecycle';
export { useBtcAddressLoader, useWalletAddresses, type WalletAddresses } from './useWalletAddresses';
export { useContactBtcBalances, useWalletBalances, type WalletBalances } from './useWalletBalances';
export { useSend, type FeeQuote, type SendRequest, type SendResult } from './useSend';
export { fetchEvmActivity, useActivity, type WalletActivity } from './useActivity';
export { useUsdtFaucet } from './useUsdtFaucet';
export { useBtcContactAccount } from './useBtcContactAccount';
export { addressFromPaymentText, checkRecipientAddress, type RecipientCheck } from './addressFormat';
export { checkAffordable, formatFee, sendErrorMessage, type SendProblem } from './sendChecks';
export { fetchBtcFeeRate, fetchBtcTransactionStatus, type BtcTransactionStatus } from './mutinynet';
