// Paykit and Pubky identifiers. These are frozen: Pubky grants are bound to
// the client id, and peers find our endpoints under the Paykit app id.

/** Pubky staging homeserver (homeserver.staging.pubky.app). Signup needs a code. */
export const STAGING_HOMESERVER = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';

/** Pubky grant client id. Never change it once grants exist. */
export const PUBKY_CLIENT_ID = 'com.jasonvdb.paykitwdkwallet';

/** Paykit app id that our payment endpoints are published under. */
export const PAYKIT_APP_ID = 'wdk-paykit-demo';
export const PAYKIT_APP_NAME = 'Paykit WDK example wallet';

/**
 * Payment endpoint identifiers. They name the test network on purpose, so no
 * real wallet mistakes a testnet address for a mainnet endpoint.
 */
export const ENDPOINT_BTC = 'btc-mutinynet-p2wpkh';
export const ENDPOINT_USDT = 'usdt-sepolia-address';

/** Endpoints we can pay to, in order of preference. */
export const SUPPORTED_ENDPOINTS = [ENDPOINT_USDT, ENDPOINT_BTC] as const;
