# Funded demo run, 27 October 2026

This is the record of the first run of [`DEMO.md`](DEMO.md) with real
testnet money, on two phones:

- **Ana (iOS)**: iPhone 17 simulator, iOS 26.5.
- **Ben (Android)**: Pixel emulator, API 36.

Both phones ran release builds, so the JavaScript was bundled into the
app. Bitcoin moved on Mutinynet (a signet) and USD₮ on Ethereum Sepolia.
Before the run, Ana held 500,000 sats, 1,000 USD₮ and about 0.04 ETH for
gas. Ben held 300,000 sats, 1,000 USD₮ and 0.01 ETH.

**Result: money moved both ways, in both assets, on every payment path
in the demo.** That covers paying by address, paying by pubky through a
public endpoint, private payments to a contact, Collect, one-time and
recurring requests with proofs and receipts, and automatic payments under
an Allowance. The run found 6 bugs while paying and 3 while asking for
money, and fixed all of them. A review of those fixes found 1 more bug
and 3 small issues, which are also fixed (see
[Bugs found and fixed](#bugs-found-and-fixed)). No payment was ever sent
twice. Every request or billing period has exactly one transaction on the
explorers.

## How the transactions were checked

Every transaction in this record was checked again in Chrome on
27 October 2026, through the explorers' own APIs: the Mutinynet esplora
API on mutinynet.com and the Blockscout API on eth-sepolia.blockscout.com.
All 14 Bitcoin transactions are confirmed. All 14 Sepolia transactions
succeeded, and each one moved the amount and went in the direction this
record says. The amounts, addresses and fees below come from those
checks. One transaction of each kind was also opened on its explorer
page (mutinynet.com and sepolia.etherscan.io) to check that the links
work.

## Steps

| # | Step (DEMO.md) | Result | Notes |
|---|---|---|---|
| 1 | Wallet basics on both phones | Passed after a fix | Balances matched the funding. Bitcoin rows had no time and sorted below older Ethereum rows; fixed in `ad6447e`. |
| 2 | Pay by address, both ways | Passed after a fix | 10,000 sats from Ana to Ben; 2 USD₮ from Ben to Ana. USD₮ sends stayed Pending until Blockscout caught up, and the fee went missing; fixed in `ad6447e`. Activity detail called the USD₮ address private; fixed in `c33fa86`. |
| 3 | Pay a stranger by pubky (DEMO steps 2 and 3) | Passed | The phones removed each other first. Ana paid Ben 1 USD₮ and 5,000 sats through his public endpoint, and the Bitcoin went to his main address. They then added each other again, and the link closed in about 25 s. |
| 4 | Private payments to a contact (DEMO step 5), both ways, both assets | Passed | Bitcoin went to the payee's contact account (one private address per contact). Ben kept the same account for Ana after the re-link. |
| 5 | Collect (DEMO step 6) on both phones | Passed after a fix | Ben's first Collect left 300 sats behind that could never move; fixed in `42c67d1`. After the fix, each Collect made one output and left 0. |
| 6 | "Get test USD₮" on Android | Passed | 1,000 USD₮ minted; Activity shows "Test USD₮ minted". |
| 7 | Seal rings on request and activity rows | Passed after a fix | Linked contacts showed a dashed ring outside People; fixed in `d16e58b`. |
| 8 | One-time request in Bitcoin (DEMO step 7) | Passed | Ana asked for 0.0001 BTC ("Dinner"). Ben paid, Ana checked it on chain, and the receipt reached Ben about 1 minute after the payment. |
| 9 | One-time request in USD₮ (DEMO step 7) | Passed | Ben asked for 3 USD₮ ("Lunch"). Ana paid; the EIP-712 proof went after the block; Ben's receipt reached Ana in about 25 s. |
| 10 | Decline and cancel (DEMO step 7) | Passed | No money moved. Each answer reached the other phone within about 10 s. |
| 11 | Recurring request paid by hand (DEMO step 8) | Passed after a fix | 2,000 sats a minute, 3 payments ("Phone plan"). Period 3 was put off with "Not now" and paid later. The finished request still read "Active"; fixed in `f03a0b4` and, after review, `929bcee`. |
| 12 | Automatic payments (DEMO step 9) | Passed after a fix | A new Allowance paid 3 × 1 USD₮ ("Streaming") and 3 × 5 USD₮ ("Gym") with no taps. A 6 USD₮ request waited (over the per-payment limit), and so did the 4th "Gym" period (over the hourly limit). Ana then stopped the payments and ended the Allowance. Request money wrongly promised "a tap per payment"; fixed in `d103d6d`. |
| 13 | Closing the app mid-payment | Passed | The payer was closed after the broadcast, the payer during the send, and the payee before its check. Each case ended with one transaction and a receipt, and none offered to pay again. |
| 14 | Release builds, linked, on the Wallet tab | Passed | Rebuilt after every round of fixes. The new code was confirmed in both JS bundles. |

## Transactions

### Bitcoin (Mutinynet)

| Step | What | Fee | Transaction |
|---|---|---|---|
| 2 | Ana → Ben, 10,000 sats to his address | 141 sats | [cc2a38bc…](https://mutinynet.com/tx/cc2a38bce7b89e3b6f47f112492d4050a083ec56858378af6b8cc6eeed8cb218) |
| 4 | Ana → Ben, 10,000 sats to his contact account for Ana | 141 sats | [3cb2657e…](https://mutinynet.com/tx/3cb2657e83c592380cf3f5f2ac6ddf4f2d42abeb5e91a086aa708f9f5bf2b367) |
| 4 | Ben → Ana, 5,000 sats to her contact account for Ben | 141 sats | [fc604633…](https://mutinynet.com/tx/fc604633222475dce24eedd621e4b498da8b32936adf3d4606dad2f88b87d563) |
| 5 | Ben's Collect before the fix: 9,559 sats moved, 300 left behind | 141 sats | [2694c57a…](https://mutinynet.com/tx/2694c57a1d001c2e7915d083ad5f4b385278850b68cf91ee493a278353c6f6f4) |
| 3 | Ana → Ben by pubky, 5,000 sats to his public address | 141 sats | [bfdf88c2…](https://mutinynet.com/tx/bfdf88c2217cad97f2d75cf711da17fed1ac7c2510d46772d907827e261c4974) |
| 5 | Ana's Collect after the fix: 4,853 sats, one output | 147 sats | [ac032666…](https://mutinynet.com/tx/ac03266616224d2ca10c64778c44f8ff33b7d34d4707566dd3aca1c556abe490) |
| 4 | After re-adding: Ana → Ben, 5,000 sats to the same contact account | 141 sats | [f738accd…](https://mutinynet.com/tx/f738accd40f12d3f6239d90d882f6a2f04d0a274dac9e3e6a7f44315ad8288dc) |
| 5 | Ben's Collect after the fix: 5,000 + the old 300 sats, one output of 5,085 | 215 sats | [26fae892…](https://mutinynet.com/tx/26fae89216845111c8bc0dcff004bed2d9859a5f9d5d9877cefe32def58a56ba) |
| 8 | "Dinner": Ben pays Ana's 0.0001 BTC request | 141 sats | [6e86bd85…](https://mutinynet.com/tx/6e86bd85c090ed0bc581fe5e1e454787abec7857bb560d74a282a47c34c66939) |
| 11 | "Phone plan" period 1: Ana pays 2,000 sats | 141 sats | [9b336f0f…](https://mutinynet.com/tx/9b336f0f0811bd8e46718fcc3f350418f7a86b9252cba83200ce32290dd08afc) |
| 11 | "Phone plan" period 2 (Pay now) | 141 sats | [b14ae7a3…](https://mutinynet.com/tx/b14ae7a3dffadb8092728d79a1dca9cf7663fe9525d768dda360106fc0c44197) |
| 11 | "Phone plan" period 3, put off with "Not now", then paid | 141 sats | [08cf3b67…](https://mutinynet.com/tx/08cf3b677e01f4eb1051643dfb36f20ee1789d03a2856a6ec536b104d0442965) |
| 13 | "Books": Ben pays Ana 5,000 sats; Ana (the payee) closed before her check | 141 sats | [cfee5c68…](https://mutinynet.com/tx/cfee5c68b3540db8cf04bf481343d24af7f0b23c9a264e76a7211e6eeab3d9e0) |
| 13 | "Snacks": Ana pays Ben 3,000 sats; Ana closed during the acceptance, then 2 s after Pay | 141 sats | [29682f59…](https://mutinynet.com/tx/29682f59ec5ebaf61ef9183568dc3696a3e55842a80e4fd78e916d8945df3457) |

### USD₮ (Ethereum Sepolia)

Sepolia gas was tiny during the run (the review showed "less than
0.000001 ETH"), so fees are left out.

| Step | What | Transaction |
|---|---|---|
| 2 | Ben → Ana, 2 USD₮ to her address | [0xa9730d…](https://sepolia.etherscan.io/tx/0xa9730dd892ba07bc501992d088c50e53ef43045059c926705e065aa40b62560c) |
| 4 | Ana → Ben, 2 USD₮ to a contact | [0xab6914…](https://sepolia.etherscan.io/tx/0xab69145da1d2aaf942e2b78f2e33ed3f2c3b97e1a93921dcb354ad1cc79e583f) |
| 4 | Ben → Ana, 1 USD₮ to a contact | [0x38ebf1…](https://sepolia.etherscan.io/tx/0x38ebf1316b0d765ec2066941fc0e3a32afda11c1ecc84a54f8f988f20369aafe) |
| 6 | Ben's in-app mint, 1,000 test USD₮ | [0x867d31…](https://sepolia.etherscan.io/tx/0x867d312e09714c096c6706579ce59197b76e25cef0115e0ea81002ef247ec303) |
| 3 | Ana → Ben by pubky, 1 USD₮ (public endpoint) | [0xd43c63…](https://sepolia.etherscan.io/tx/0xd43c633202eeca79fd5263fa53724d7bcb58110d8f27e9679a5b7459b46a3406) |
| 4 | After re-adding: Ben → Ana, 1 USD₮ (also the re-test of the Pending fix) | [0xb160f0…](https://sepolia.etherscan.io/tx/0xb160f03e87ba6b4578f952e109d68d2d99b3fe90ea9327bbbceadcb7bd233ce5) |
| 9 | "Lunch": Ana pays Ben's 3 USD₮ request | [0xccbab2…](https://sepolia.etherscan.io/tx/0xccbab24e39745850f19d2bcf134d6e7b4447b41ce1ae21fb61b068ace042a94b) |
| 12 | "Streaming" period 1, 1 USD₮, paid automatically | [0xb2140c…](https://sepolia.etherscan.io/tx/0xb2140c13949d6e74681bed88e8b535d1dc63f55d82ffc7eae84ca90e816d4972) |
| 12 | "Streaming" period 2, automatically | [0x24d672…](https://sepolia.etherscan.io/tx/0x24d67264e12177eb6973c004d7d0729c044f1add6a35472925e2995120215f75) |
| 12 | "Streaming" period 3, automatically | [0x121acd…](https://sepolia.etherscan.io/tx/0x121acdc8df8f0fa8944da39c0eb97e05eba079bb60b678a092b0509f45121617) |
| 12 | "Gym" period 1, 5 USD₮, automatically | [0x65cf03…](https://sepolia.etherscan.io/tx/0x65cf0309622c96888d9d3bc72aca61d936b543776e842b6634c05bfe702a424d) |
| 12 | "Gym" period 2, automatically | [0x652bc4…](https://sepolia.etherscan.io/tx/0x652bc4297b48869bc1de08dc6d02466f8eb844dbfaa8494f2deee8f0c671ca71) |
| 12 | "Gym" period 3, automatically (18 of 20 USD₮ this hour); period 4 waited | [0x755260…](https://sepolia.etherscan.io/tx/0x755260f25700b606e909b4437fb018a51342ac23fe7da18a5149040b05ac0061) |
| 13 | "Taxi": Ana pays Ben 1 USD₮; Ana closed right after the broadcast | [0x2d8529…](https://sepolia.etherscan.io/tx/0x2d8529319f0c9c1d8267ffcdca05db03a84356d7aced4bae306cffb72bf3885b) |

The declines, the cancels and the requests that went over a limit moved
no money, so they have no transaction.

## Bugs found and fixed

| Commit | Bug | Fix |
|---|---|---|
| `d16e58b` | Request rows, activity rows, the Send review and Activity detail showed a linked contact's seal with a dashed ring. | `PersonSeal` takes its ring from the link state unless the caller passes one. |
| `ad6447e` | Bitcoin activity rows had no time and sorted below older Ethereum rows, because WDK reports only a block height. | Block times come from Mutinynet's esplora, cached. |
| `ad6447e` | USD₮ sends stayed Pending for 1–2 minutes after their block, while Blockscout caught up. | Pending sends are confirmed through WDK `getTransaction`. |
| `ad6447e` | A USD₮ send's fee disappeared from Activity detail once Blockscout listed it. | The fee comes from the sender's Blockscout transaction list. |
| `42c67d1` | Collect left a dust change output (300 sats) in the contact account that could never move, and the Wallet kept asking to collect it. | Collect sends the whole balance in one output; balances under 436 sats are hidden and their Collect is disabled with the reason. |
| `c33fa86` | Activity detail said a USD₮ payment went to "an address they shared only with you", but USD₮ goes to the one public Ethereum address. | The wording depends on the chain. |
| `f03a0b4` | A recurring request with every payment made still read "Active: 3 of 3 paid" and offered Stop and Cancel. | `isScheduleComplete`: "All 3 paid", and no buttons. |
| `d103d6d` | Request money promised that the payer "pays each one with a tap", even to a contact who pays automatically. | The text adds "unless they pay your requests automatically". |
| `eea3abb` | Activity detail showed "Address: Not reported by the network" under a contact who paid in Bitcoin. | The row is left out when a person is shown. |

A review of these fixes found one more bug and three small issues:

| Commit | Problem | Fix |
|---|---|---|
| `929bcee` | The payee counted every recorded proof toward "All 3 paid", including proofs its own on-chain check rejected or was still checking. Three bad proofs would have hidden Cancel request. | The payee counts only payments it verified on chain. The payer still counts what it paid. |
| `cf36b33` | A Sepolia send that another transaction replaced (same nonce) stayed Pending until restart. | It is marked Failed. |
| `31d1446`, `32269ee`, `205970d` | A docstring that contradicted the code, an unused balance total that still counted dust, and a wrong step number in DEMO.md. | Fixed. |

After the review fixes, both release builds were rebuilt and checked.
"Phone plan" and "Streaming" read "All 3 paid" on both phones: as payer
on Ana's, and as payee on Ben's, where they count only verified payments.

## Open problems

- **The Allowance from Ana to Ben is ended.** The run ended it on
  purpose. To show DEMO step 9 again, set it up again first (about
  10 s).
- **Contact-account Bitcoin is not collected.** Ana holds 15,000 sats from
  Ben's payments and Ben holds 9,000 sats from Ana's. Both Wallets show
  "Plus … BTC from contacts". Run Collect (DEMO step 6) for a clean start.
- **A USD₮ "Received" row waits for Blockscout** (1–2 minutes), though
  the balance moves within 15 s. A full fix needs an indexer or a log
  subscription.
- **Not checked on a device:** marking a replaced Sepolia send as Failed.
  It needs a replacement transaction, which the app never makes. A unit
  test covers it.
- **Not investigated:** after the app was closed during the acceptance
  wait, the queued acceptance took 1–2 minutes to leave after relaunch,
  instead of a few seconds. It did arrive, and nothing was paid twice.
- **By design:** a Bitcoin payment to a contact's public address
  (account 0) shows as "Sent", not "You paid Ben", because only addresses
  from a private list are attributed to a person.
- **Cosmetic, not fixed:**
  - The Send success sheet shows both a "Send" title and a "Sent"
    headline.
  - On iOS, the Review step keeps the compose scroll offset, the amount
    field sits under the footer until you scroll, and a request page's
    buttons sit below the fold.
  - "Next one in 17 s." shows while an earlier period is still "Due now".
- **Screenshot gap:** `ios-hourly-limit-two-due.png` has the hourly-limit
  reason scrolled off. The exact text is in DEMO.md.

## Balances after the run

| | Bitcoin | Contact accounts | USD₮ | ETH |
|---|---|---|---|---|
| Ana (iOS) | 464,725 sats | 15,000 sats | 979 | about 0.04 |
| Ben (Android) | 309,221 sats | 9,000 sats | 2,021 (1,000 of it minted in the app) | about 0.01 |

## Screenshots

All 39 are in [`screenshots/demo-run/`](screenshots/demo-run/). None
shows a recovery phrase or a backup.
