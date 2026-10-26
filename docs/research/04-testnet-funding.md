# 04 — Getting testnet funds into the demo wallets

Research date: 2026-10-26. Scope: how the two demo wallets (iOS simulator and Android emulator) get
testnet funds with as little human effort as possible, for each chain that WDK supports. Statements
marked **verified** were checked live from this Mac on the research date. Statements marked
**unverified** come from documentation or memory and were not tested.

## TL;DR

1. **The easiest chain to fund is Ethereum Sepolia with USDT.** Aave's Sepolia faucet contract is
   **permissionless**: anyone can mint up to 10,000 test USDT (6 decimals) per call, with no limit on
   the number of calls (**verified** by `eth_call` and `eth_estimateGas`). Gas costs almost nothing
   today: the base fee is about 19 wei and the priority fee about 9 wei. The only ETH needed is a
   small one-time amount, which comes from the Coinbase CDP faucet API (needs an API key) or from a
   single manual faucet visit.
2. **The second chain is Bitcoin on Mutinynet (a signet with 30-second blocks).** The faucet has an
   HTTP API: `POST /api/onchain`, up to 1,000,000 sats per 24 hours. The API needs a 24-hour JWT,
   which you get through a **GitHub device-flow login**. That login is the only human step.
   `electrum.mutinynet.com:50001` (plain TCP) answers Electrum protocol 1.4 (**verified**). Its TLS
   port has an **expired certificate**, which WDK rejects (**verified**). WDK's BTC module accepts
   it with `network: 'testnet'`, because signet uses the same `tb1` address format.
3. **Use a "treasury" pattern on both chains.** A human funds one treasury key per chain once. After
   that, a repo script (`scripts/fund-demo.*`) tops up both app wallets with no human involved.
   Sepolia funds never run out in practice because minting is unlimited. BTC funds recirculate
   between the two apps and only lose transaction fees.
4. **Fallback with no humans at all: local chains in Docker.** Use Bitcoin Core regtest with electrs
   (the `polarlightning/bitcoind:30.0` arm64 image is **already pulled** on this Mac) and Anvil for
   EVM (`brew install foundry` gives 1.8.5). Colima and Docker are installed and running
   (**verified**). On Android, run `adb reverse` so that both simulators reach the host at
   `127.0.0.1`.
5. **Avoid Solana devnet as a demo chain.** The public RPC faucet is **closed**:
   `requestAirdrop` returns `410 "The RPC faucet is closed on this cluster"` on both
   `api.devnet.solana.com` and `api.testnet.solana.com` (**verified**). The remaining faucets are a
   rate-limited web page that explicitly asks AI agents not to use it, small CDP API amounts, or a
   Helius API key. **Avoid TON, Tron and Spark for funding automation.** All three faucets are
   Telegram, captcha or web-only, and Spark's regtest network has no Lightning, so it cannot demo
   `btc-lightning-bolt11`.

## What is installed on this Mac (verified)

| Tool | State |
|---|---|
| `bitcoind`, `bitcoin-cli`, `electrs`, `anvil`, `forge`, `cast`, `solana`, `solana-test-validator` | **Not installed** |
| `docker` + `colima` | Installed. Colima is running (aarch64, `vz`, virtiofs). The Docker context is `colima`. |
| Docker images already pulled | `polarlightning/bitcoind:30.0` (arm64; entrypoint `/entrypoint.sh`, cmd `bitcoind`), `polarlightning/lnd:0.20.0-beta`, `synonymsoft/homeserver-testnet:latest`, `postgres:17*` |
| Homebrew formulas available (not installed) | `foundry` 1.8.5, `solana` 4.3.2, `bitcoin` 31.1. There is no `electrs` formula. |
| Docker Hub arm64 images (no pull needed until used) | `getumbrel/electrs:v0.12.0`, `cculianu/fulcrum:v2.1.4` (supports Electrum over WebSocket), `mempool/electrs:v3.3.0`, `blockstream/esplora:latest-arm64`, `bitcoin/bitcoin` |

Two containers are already running: `postgres` on port 5432 and `marketplace-postgres` on 55432.
Avoid those ports.

## Per-chain comparison

"Human?" means a person must act at least once. "Repeatable" means the demo can be re-run later
without a person.

| Chain / network | Funding method | Automation-friendly? | Amount / limits | Reliability (2026-10-26) | Human? | Repeatable without a human? |
|---|---|---|---|---|---|---|
| **EVM Sepolia: USDT** | Aave V3 faucet contract `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`, `mint(token,to,amount)` for USDT `0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0` | **Yes.** It is an on-chain call. `isPermissioned()` returns `false` (**verified**). | ≤ 10,000 USDT per call (`MAX_MINT_AMOUNT = 10000 * 10**decimals`). Calls are unlimited. A 20,000 USDT mint reverts with "Mint limit transaction exceeded" (**verified**). | High. It is a contract with no backend. Gas for a mint is about 55k (**verified** estimate). | Only to get a little ETH for gas | **Yes** |
| **EVM Sepolia: ETH (gas)** | Coinbase CDP Faucet API (`@coinbase/cdp-sdk`, `cdp.evm.requestFaucet`) | **Yes**, after a one-time CDP API key signup | 0.0001 ETH per claim, 1,000 claims per 24 h (docs). Whether that limit is per address or per project is undocumented. | Good (commercial service) | One-time API key | **Yes** |
| EVM Sepolia: ETH (alt) | Google Cloud Web3 faucet, pk910 PoW faucet (`sepolia-faucet.pk910.de`, browser mining), Alchemy (needs a mainnet balance), Chainlink (GitHub plus wallet login) | No: browser, captcha or login | Google about 0.05 ETH/day (**unverified**). PoW scales with mining time. | Medium | Yes | Only through a treasury |
| EVM Sepolia: Candide "USD₮" `0xd077A400968890Eacc75cdc901F0356c943e4fDb` (the token the WDK starter app uses) | Candide dashboard faucet (`dashboard.candide.dev/faucet`) | **No.** The token's `mint` is owner-only: it reverts with "Ownable: caller is not the owner" (**verified**). | Unknown | — | Yes | Only through a treasury |
| EVM Base Sepolia: USDT | Aave faucet `0xd9145b5f45ad4519c7accd6e0a4a82e83bb8a6dc` for USDT `0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a` | **Yes.** `isPermissioned()` returns `false`, and a mint simulates OK with about 89k gas (**verified**). | ≤ 10,000 per call | High. The base fee is 0.005 gwei, plus an L1 data fee. | ETH only (the CDP faucet supports Base Sepolia) | **Yes** |
| **Bitcoin Mutinynet (signet, 30-second blocks)** | `POST https://faucet.mutinynet.com/api/onchain` with a Bearer JWT, or `mutinynet-cli onchain` | **Mostly.** HTTP API. Without a JWT the endpoint returns `401 {"error":"Missing token"}` (**verified**). | ≤ 1,000,000 sats per 24 h per GitHub user **and** per IP (source: `MAX_SEND_AMOUNT`, 86,400 s window). The CLI defaults to 10,000 sats. | Good. The esplora tip was height 3,536,968. Electrum on TCP 50001 is live (`mempool-electrs 3.3.0`). | GitHub device login. The JWT lasts 24 h. | **Likely**: store the GitHub OAuth token and re-exchange it daily (**unverified**, see below) |
| Bitcoin testnet4 | mempool.space testnet4 faucet and others | No: GitHub, Twitter or LN payment, plus captcha (**unverified**, secondary sources) | Small | Faucets are scarce. The Trezor Blockbook `tbtc4.trezor.io/api/v2` is in sync (**verified**). | Yes | Only through a treasury |
| Bitcoin testnet3 (what the WDK starter app uses) | coinfaucet.eu, bitcoinfaucet.uo1.net and similar | No: captcha | Small | Testnet3 is deprecated, though Trezor Blockbook `tbtc1.trezor.io/api/v2` is in sync (**verified**) | Yes | Only through a treasury |
| Bitcoin default signet | alt.signetfaucet.com | No: a Cloudflare challenge broke Bitcoin Core's `getcoins.py` | Small | Varies with the operator's Cloudflare setting | Yes | Only through a treasury |
| **Bitcoin regtest (local)** | `bitcoin-cli -regtest sendtoaddress` plus `generatetoaddress` | **Yes, fully** | Unlimited | As reliable as Docker | No | **Yes** |
| **EVM Anvil (local)** | `anvil_setBalance`, plus a self-deployed test USDT, or Anvil forking Sepolia | **Yes, fully** | Unlimited | As reliable as your machine | No | **Yes** |
| Solana devnet | `requestAirdrop` on the public RPC | **No: closed.** Returns 410 (**verified**). | — | Dead | — | — |
| Solana devnet (alt) | faucet.solana.com (web) | No. The page says AI agents should **not** use it. | 2 requests per 8 h; GitHub login raises the limit | OK | Yes | No |
| Solana devnet (alt) | CDP Faucet API (`cdp.evm`-style SDK, Solana devnet) | Yes, with an API key | 0.00125 SOL per claim, 10 per day; 1 USDC per claim, 10 per day | Good | One-time API key | Yes, but amounts are tiny: one new account's rent exemption is about 0.00089 SOL |
| Solana devnet (alt) | Helius `requestAirdrop` at `https://devnet.helius-rpc.com/?api-key=…` | Yes, with a free API key | Undocumented (**unverified**) | Unknown | One-time API key | Probably |
| Solana devnet (alt) | `devnet-pow` (Ellipsis Labs, `cargo install devnet-pow`) | Yes, as a CLI | Varies | Stale: crate v0.1.4 was last published 2023-05-30 (**verified**) | No | Unknown |
| Solana local | `solana-test-validator` (Anza installer, or brew `solana` 4.3.2; whether brew includes the validator is **unverified**) | Yes | Unlimited | Local | No | Yes |
| TON testnet | Telegram `@testgiver_ton_bot` | No: Telegram plus captcha | 2 TON per hour | OK | Yes | Only through a treasury |
| Tron Nile / Shasta | `nileex.io/join/getJoinPage` (reCAPTCHA), or TronFAQBot in Telegram/Discord (`!nile <addr>`, `!nile_usdt <addr>`) | No | 2,000 TRX and 2,000 test USDT per 24 h (bot) | OK. A USDT transfer burns energy, worth tens of TRX without staking (**unverified** on Nile). | Yes | Only through a treasury |
| Spark REGTEST (Lightspark-hosted) | `https://app.lightspark.com/regtest-faucet` (web), then `claimStaticDeposit` | No: web page, no documented API | Unknown | OK. **No Lightning on regtest** (Breez docs). WDK supports only `MAINNET` and `REGTEST`; `SIGNET` and `TESTNET` fall back to local endpoints. | Yes | Only through a treasury. Spark-to-Spark transfers are fee-free, so funds circulate indefinitely. |
| Liquid testnet | liquidtestnet.com faucet | — | — | No WDK module exists, so Liquid is not applicable | — | — |

## Chain details

### EVM: Sepolia (recommended chain A)

**Test USDT (verified, 2026-10-26, RPC `https://ethereum-sepolia-rpc.publicnode.com`):**

- Aave V3 Sepolia (source: `bgd-labs/aave-address-book`, `src/AaveV3Sepolia.sol`):
  - `FAUCET = 0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`
  - `USDT_UNDERLYING = 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0`: `symbol()` is "USDT",
    `decimals()` is 6, and `owner()` is the faucet.
- Contract source: `aave-dao/aave-v3-origin`, file
  `src/contracts/mocks/testnet-helpers/Faucet.sol`. Its `mint(address token, address to, uint256 amount)`
  is gated by `onlyOwnerIfPermissioned`. `isPermissioned()` (selector `0xe2a4157c`) returns `false`
  on Sepolia, so **anyone can mint to any address**.
- Simulation from an arbitrary zero-balance `from`: `eth_call` of minting 1,000 USDT returned
  `1000000000`, and `eth_estimateGas` returned `0xd7fa` (55,290 gas).
- Function selector: `mint(address,address,uint256)` is `0xc6c3bbe6`.

**Gas:**

- The latest block had `baseFeePerGas` of 19 wei, and `eth_maxPriorityFeePerGas` returned 9 wei.
- WDK EVM (`@tetherto/wdk-wallet-evm@1.0.0-beta.24`, which pins `ethers@6.17.0`) calls
  `provider.getFeeData()`. In ethers 6.17.0, that calls `eth_maxPriorityFeePerGas` and computes
  `maxFeePerGas = 2*baseFee + priority` (**verified** in the ethers source on unpkg).
- So today, a USDT transfer costs about 50k × 47 wei, which is about 2.4e-12 ETH. A **single CDP
  claim of 0.0001 ETH covers a huge number of transactions at current fees.**
- Sepolia gas has spiked in the past. At 1 gwei, 0.0001 ETH covers only about 2 transfers. Keep
  **at least 0.01 to 0.05 ETH in the treasury** and top up each app with 0.001 ETH at a time.

**Where the ETH comes from (in order of preference):**

1. **Coinbase CDP Faucet API.** After signup at portal.cdp.coinbase.com, set `CDP_API_KEY_ID` and
   `CDP_API_KEY_SECRET` (the docs also list `CDP_WALLET_SECRET`; whether a faucet-only call needs it
   is unclear). Then call
   `cdp.evm.requestFaucet({ address, network: "ethereum-sepolia", token: "eth" })`. The docs example
   uses `"base-sepolia"`; the exact Sepolia network string is **unverified**. The limit is 0.0001 ETH
   per claim, 1,000 claims per 24 h. The CDP faucet also gives USDC and EURC, but **not USDT**.
2. **One manual faucet visit into the treasury.** Use the Google Cloud Web3 faucet or the pk910 PoW
   faucet. The treasury then lasts a very long time.
3. **Ask the Synonym or Paykit team** whether a funded Sepolia key already exists (open question).

**Option B: no ETH in the app wallets at all.** Use `@tetherto/wdk-wallet-evm-7702-gasless` (or
`-erc-4337`) with a **Pimlico** bundler and paymaster in sponsored mode. Pimlico advertises
sponsorship as "free on testnets", but you need a dashboard API key, which is a one-time human step.

- The WDK starter app (`tetherto/wdk-starter-react-native`, `.env.example`) does exactly this:
  `EXPO_PUBLIC_EVM_ETHEREUM_BUNDLER_URL=https://api.pimlico.io/v2/sepolia/rpc?apikey=…`.
- With sponsorship, the app could call the Aave faucet through a sponsored UserOperation. That gives
  an in-app "Get test USDT" button with zero ETH anywhere. **Unverified**: whether WDK's gasless
  module's `sendTransaction` sponsors an arbitrary contract call.
- This adds an AA dependency and an API key. For a simple reference app, prefer plain
  `wdk-wallet-evm` with a little ETH.

**Avoid the starter app's token** `0xd077A400968890Eacc75cdc901F0356c943e4fDb` (Candide "USD₮") for
automation. Its `mint` is owner-only (**verified** revert). It matters only if you use Candide's
pay-gas-in-token paymaster.

**Paykit fit:**

- Paykit's identifier spec uses `usdt-ethereum-address` and `usdt-arbitrum-address`.
- `specs/erc20-payment-proofs.md` signs over `chain_id` (any EVM chain ID, for example `11155111`).
  It requires the verifier to take the token contract and chain from the selected endpoint, so a
  Sepolia Aave USDT works with the spec.
- **Open question for the architecture doc:** keep the rail segment `ethereum` and put
  `chain_id: 11155111` in the payload, or use a distinct identifier such as `usdt-sepolia-address`.

### Bitcoin: Mutinynet (recommended chain B)

**Faucet facts** (read from `MutinyWallet/mutinynet-faucet-rs`, latest commit 2026-10-11, plus live
probes):

- Routes: `POST /api/onchain` takes `{"sats":<u64>,"address":"<addr or BIP21>"}` and returns
  `{"txid","address"}`. `POST /api/lightning` takes `{"bolt11"}`. `POST /api/channel`,
  `/api/arkade`, and `GET /api/limits` also exist. All of these sit behind `auth_middleware`.
  `/api/bolt11` (create an invoice) and `/api/lnurlw` have no auth but are IP-limited to 60 per day.
- Auth accepts either `Authorization: Bearer <JWT>` or `Authorization: L402 <token>:<preimage>`. L402
  means paying a **mainnet** Lightning invoice, so skip it.
- The JWT `exp` is **24 h**. You get it from `POST /auth/github/device` with body
  `{"code":"<GitHub OAuth access token>"}`. The server checks that the GitHub token was issued to the
  faucet's OAuth app, then reads the user's verified primary email.
- The faucet's OAuth `client_id` is `Ov23liIa6qfR9KtYHwUF` (**verified** via
  `GET /auth/github/client_id`). The `Ov23li` prefix means a classic OAuth app, whose tokens
  normally **do not expire**. A script can therefore keep the GitHub token (in a local file outside
  git) and re-exchange it for a fresh JWT every day, with no human after the first device login.
  This is **unverified in practice**.
- Limits: `MAX_SEND_AMOUNT = 1_000_000` sats per request, and a rolling 24 h cap of 1,000,000 sats
  per user **and** per IP. Premium users bypass the cap.
- CLI: `cargo install mutinynet-cli` (v0.1.3, 2026-05-07). Run `mutinynet-cli login` (GitHub device
  flow; it stores the JWT at `~/.mutinynet/token`), then `mutinynet-cli onchain <addr> --sats N`.
  The CLI also honours `--token` and the `MUTINYNET_FAUCET_TOKEN` environment variable.

**Electrum for WDK (verified):**

- `electrum.mutinynet.com:50001` over TCP answers `server.version` with
  `["mempool-electrs 3.3.0-141215c(dirty)","1.4"]`. `blockchain.headers.subscribe` returned height
  3,536,968.
- Port `50002` (TLS) fails with `CERTIFICATE_VERIFY_FAILED: certificate has expired`. WDK
  beta.16 and later rejects expired certificates, so **use TCP 50001**. TCP is plaintext; that is
  acceptable for a testnet demo, but say so in the docs.
- Ports `mutinynet.com:50001` and `50002` are closed. No WebSocket Electrum port was found.

```js
// WDK BTC on Mutinynet. Signet shares testnet's tb1 address format and tpub version
// bytes, so bitcoinjs-lib's `testnet` network params work. Derivation is m/84'/1'/…
new WalletManagerBtc(seed, {
  client: { type: 'electrum', clientConfig: { host: 'electrum.mutinynet.com', port: 50001, protocol: 'tcp' } },
  network: 'testnet'
})
```

**Caveats:**

1. WDK BTC's network values are only `bitcoin`, `testnet` and `regtest` (`src/signers/seed-signer-btc.js`).
2. **Unverified**: whether `ElectrumTcp` works inside the WDK React Native worklet. The package has
   a `bare` export and depends on `bare-node-runtime`, so `node:net` and `node:tls` are probably
   shimmed. The official starter app avoids the question by using `blockbook-http`.
3. **Unverified**: Electrum fee estimation on a quiet signet may return `-1`. Check how WDK handles
   that. The Blockbook client fetches fees from **mainnet** mempool.space (`blockbook-client.js`
   line 330), which is wrong for signet but harmless.
4. Explorer: `https://mutinynet.com/tx/<txid>` and `https://mutinynet.com/api/...` (esplora).

**Paykit fit:** the endpoint identifier is `btc-bitcoin-p2wpkh` (a WDK BIP84 address).
`btc-lightning-bolt11` is **not** reachable, because WDK has no Lightning wallet on any test network.
Spark's regtest has no Lightning, and Spark SIGNET is not wired in WDK.

### Solana devnet (not recommended)

- **Verified 2026-10-26:** `requestAirdrop` returns
  `{"code":410,"message":"The RPC faucet is closed on this cluster. Request test SOL at https://faucet.solana.com"}`
  on devnet and on testnet.
- faucet.solana.com allows 2 requests per 8 h, optionally more with GitHub, and says AI agents
  should not use it.
- The CDP API gives only 0.00125 SOL per claim (10 per day).
- Helius devnet airdrop needs a free key; its limits are undocumented.
- There is no official test USDT on devnet; you would create your own SPL mint.
- WDK Solana config: `provider: 'https://api.devnet.solana.com'` (or a local
  `http://127.0.0.1:8899`), `transferMaxFee`, `transactionMaxFee`.
- If Solana is wanted anyway, run a local `solana-test-validator` and fund with
  `solana airdrop 10 <addr> -u localhost`, which works locally.

### Tron Nile, TON testnet, Spark regtest (not recommended for funding automation)

- **Tron Nile:** reCAPTCHA web faucet, or TronFAQBot commands in the official Telegram or Discord
  developer groups: `!nile <addr>` and `!nile_usdt <addr>`, 2,000 per token per 24 h. There is no
  API. Tron is the canonical USDT rail and Paykit has `usdt-tron-address`, but energy and bandwidth
  costs complicate sends. The WDK starter app has Tron "on hold" because gasfree.io is migrating its
  testnet API.
- **TON:** `@testgiver_ton_bot` on Telegram, 2 TON per hour with a captcha. TON is not a Paykit rail
  in the specs.
- **Spark REGTEST:** web faucet only. Breez's docs say "Regtest Network doesn't have a developed
  Lightning Network". The WDK module README says: "`TESTNET` and `SIGNET` fall back to local
  endpoints in the bundled Spark SDK". Transfers are fee-free, so a single manual funding would
  last, but there is no Lightning invoice demo.
  `buildonspark/lightning-mpp-sdk` `demo/server/modules/faucet.ts` shows the treasury-faucet pattern
  (a REGTEST SparkWallet paying 5,000 sats per claim).

## Recommended funding plan

Primary chains: **Sepolia (USDT plus a little ETH)** and **Bitcoin Mutinynet**. Use one treasury per
chain, with keys in a git-ignored `.env.demo-treasury` file. They are testnet keys, but they should
still never be committed or logged.

### One-time human steps (about 10 minutes total)

1. **Sepolia ETH.** Either create a CDP API key (portal.cdp.coinbase.com), or send about 0.05
   Sepolia ETH to the treasury address from Google's or pk910's faucet.
2. **Mutinynet.** Do one GitHub device-flow login, by either route:
   - `cargo install mutinynet-cli && mutinynet-cli login`
   - Or the raw flow below, which keeps the GitHub token so that later refreshes are automatic:

   ```bash
   curl -s -X POST https://github.com/login/device/code -H 'Accept: application/json' \
     -d 'client_id=Ov23liIa6qfR9KtYHwUF&scope=user:email'
   # Human: open https://github.com/login/device and enter user_code
   curl -s -X POST https://github.com/login/oauth/access_token -H 'Accept: application/json' \
     -d 'client_id=Ov23liIa6qfR9KtYHwUF&device_code=<device_code>&grant_type=urn:ietf:params:oauth:grant-type:device_code'
   # -> {"access_token":"gho_..."}; keep it outside git
   curl -s -X POST https://faucet.mutinynet.com/auth/github/device -H 'content-type: application/json' \
     -d '{"code":"gho_..."}'      # -> {"token":"<JWT, valid 24h>"}
   ```

   The scope string and whether device flow is enabled for this OAuth app are **unverified**.
   `mutinynet-cli login` is the known-good path.

### Automated top-up (repeatable, no human)

**Sepolia**, using Foundry `cast` (`brew install foundry`, 1.8.5), or an equivalent Node script with
`ethers@6.17.0`:

```bash
export RPC=https://ethereum-sepolia-rpc.publicnode.com
export FAUCET=0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D
export USDT=0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0
# 1) Mint 1,000 test USDT straight to each app wallet (any caller; costs about 55k gas)
cast send $FAUCET "mint(address,address,uint256)" $USDT $APP_ADDR 1000000000 --rpc-url $RPC --private-key $TREASURY_KEY
# 2) Give each app wallet gas
cast send $APP_ADDR --value 0.001ether --rpc-url $RPC --private-key $TREASURY_KEY
# 3) Check balances
cast call $USDT "balanceOf(address)(uint256)" $APP_ADDR --rpc-url $RPC
cast balance $APP_ADDR --ether --rpc-url $RPC
```

The mint call data, for apps or scripts that build it by hand:
`0xc6c3bbe6` + `pad32(USDT)` + `pad32(to)` + `pad32(amount)`. The app can expose a
**"Get test USDT"** button that sends this transaction from its own WDK account, using
`sendTransaction({ to: FAUCET, value: 0, data })`, once it holds a little ETH. That makes the faucet
part of the demo.

For a CDP ETH refill, call
`cdp.evm.requestFaucet({ address: TREASURY_ADDR, network: 'ethereum-sepolia', token: 'eth' })`. The
network string is **unverified**.

**Mutinynet:**

```bash
# Refresh the JWT if older than ~23h (stored GitHub token -> faucet JWT)
JWT=$(curl -s -X POST https://faucet.mutinynet.com/auth/github/device -H 'content-type: application/json' \
  -d "{\"code\":\"$GH_TOKEN\"}" | jq -r .token)
# Check how much is left today
curl -s https://faucet.mutinynet.com/api/limits -H "Authorization: Bearer $JWT"
# Fund an app wallet (or the treasury) directly
curl -s -X POST https://faucet.mutinynet.com/api/onchain -H "Authorization: Bearer $JWT" \
  -H 'content-type: application/json' -d '{"sats":200000,"address":"tb1q..."}'
```

With a 1,000,000 sats per day cap, fund each app with about 200k sats per day directly. Or fill a
treasury once and redistribute it with a small WDK or `bitcoinjs` script. Blocks every 30 seconds
mean a demo transaction confirms within about 30 to 60 seconds.

### Suggested repo layout

The implementation agents decide the details. A starting point:

- `scripts/fund-demo.ts`: reads the two app addresses (printed by each app on its "Receive" screen,
  or derived from the demo seeds), then runs the Sepolia and Mutinynet top-ups above. It does
  nothing if balances are already above a threshold.
- `docs/FUNDING.md`: the one-time human steps, and how to repeat the demo.

## Fallback: local chains (zero humans, zero network)

Use this fallback when public faucets fail, or for CI. It is **not a public testnet**: it has no
public explorer and nobody else can verify the transactions. It still involves no real money,
which fits "testnet only" in spirit. Mark it clearly in the UI ("Local regtest" or "Local Anvil").

**Bitcoin regtest.** The bitcoind image is already pulled. electrs needs a pull, about
`getumbrel/electrs:v0.12.0` arm64. The flags below are a sketch; check them against electrs v0.12
docs (**unverified**).

```bash
docker network create pkw
docker run -d --name pkw-bitcoind --network pkw -p 18443:18443 polarlightning/bitcoind:30.0 \
  bitcoind -regtest -server -txindex -fallbackfee=0.0002 -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0 \
  -rpcuser=demo -rpcpassword=demo -listen=1 -bind=0.0.0.0
docker run -d --name pkw-electrs --network pkw -p 50001:50001 getumbrel/electrs:v0.12.0 \
  --network regtest --daemon-rpc-addr pkw-bitcoind:18443 --daemon-p2p-addr pkw-bitcoind:18444 \
  --auth demo:demo --electrum-rpc-addr 0.0.0.0:50001 --db-dir /tmp/electrs
alias bcli='docker exec pkw-bitcoind bitcoin-cli -regtest -rpcuser=demo -rpcpassword=demo'
bcli createwallet miner && MINER=$(bcli -rpcwallet=miner getnewaddress)
bcli generatetoaddress 101 $MINER            # coinbase maturity
bcli -rpcwallet=miner sendtoaddress bcrt1q... 1 && bcli generatetoaddress 1 $MINER
# Optional auto-miner: while true; do bcli generatetoaddress 1 $MINER >/dev/null; sleep 10; done
```

The WDK config is
`{ client: { type:'electrum', clientConfig:{ host:'127.0.0.1', port:50001, protocol:'tcp' } }, network:'regtest' }`,
which produces `bcrt1` addresses. If the worklet turns out to need WebSocket Electrum, use
`cculianu/fulcrum` instead; it supports WebSocket.

**EVM Anvil** (`brew install foundry`):

```bash
anvil --host 0.0.0.0 --port 8545 --chain-id 31337 --block-time 2
cast rpc anvil_setBalance $APP_ADDR 0x8AC7230489E80000 --rpc-url http://127.0.0.1:8545   # 10 ETH
# Test USDT: deploy a 6-decimals ERC-20 with public mint (contracts/TestUSDT.sol) using forge create, or:
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --chain-id 11155111 --host 0.0.0.0
```

The second `anvil` command runs a local fork of Sepolia. The same Aave faucet and USDT addresses
work there, and `anvil_setBalance` provides ETH. Fork mode depends on the upstream RPC staying
reachable.

**How the simulators reach the host:**

- **iOS Simulator** shares the Mac's network stack, so `127.0.0.1:<port>` works.
- **Android emulator:** the host is `10.0.2.2`. Simpler: run
  `adb reverse tcp:50001 tcp:50001 && adb reverse tcp:8545 tcp:8545` (and do the same for any local
  Pubky homeserver port). Then **both apps use `127.0.0.1`**. Re-run `adb reverse` after each
  emulator restart.
- Plain-HTTP JSON-RPC (`http://127.0.0.1:8545`) on Android needs cleartext allowed. The React Native
  template's debug manifest allows it; release builds need a `network_security_config`.
  **Unverified**: whether WDK's Bare worklet networking is subject to Android's cleartext policy at
  all, since it does not use OkHttp.

## Risks and mitigations

1. **Faucet terms change or a faucet disappears.** Faucets are third-party services. Mitigation:
   use the treasury pattern, keep the local-chain fallback scripted, and pin the contract addresses
   in one config file.
2. **Sepolia gas spikes.** Mitigation: keep 0.01 to 0.05 ETH in the treasury, set `transferMaxFee`
   in WDK, and show the fee in the UI.
3. **Mutinynet's 24 h JWT and 1M sats per day cap.** Mitigation: store the GitHub token and refresh
   the JWT automatically, keep a BTC treasury, and send small demo amounts (1k to 10k sats).
4. **Plaintext Electrum TCP on Mutinynet,** because its TLS certificate has expired. Mitigation:
   accept it for a testnet demo and document it. Optionally run a local Fulcrum or electrs connected
   to a Mutinynet bitcoind (heavy).
5. **`ElectrumTcp` inside the RN worklet is unproven.** Mitigation: spike it first. If it fails, use
   a Blockbook-HTTP endpoint (none is known for Mutinynet; Trezor only serves testnet3 and testnet4)
   or a WebSocket Electrum server (local Fulcrum).
6. **Solana devnet's RPC faucet is closed.** Mitigation: don't pick Solana, or use a local validator.
7. **Treasury keys in the repo.** Mitigation: keep them in a git-ignored `.env.demo-treasury`, never
   log them, and use testnet-only keys that never touch mainnet.
