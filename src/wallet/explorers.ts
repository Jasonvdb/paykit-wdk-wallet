// Links to public block explorers, so a user can check a transaction or
// address outside the app. Testnet explorers only.
import { MUTINYNET_EXPLORER, SEPOLIA_EXPLORER } from '../config/chains';
import type { Chain } from './assets';

export function transactionUrl(chain: Chain, hash: string): string {
  return chain === 'bitcoin' ? `${MUTINYNET_EXPLORER}/tx/${hash}` : `${SEPOLIA_EXPLORER}/tx/${hash}`;
}

export function addressUrl(chain: Chain, address: string): string {
  return chain === 'bitcoin' ? `${MUTINYNET_EXPLORER}/address/${address}` : `${SEPOLIA_EXPLORER}/address/${address}`;
}
