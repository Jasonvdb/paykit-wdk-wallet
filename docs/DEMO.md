# Demo script

A step-by-step run of every feature on two phones on one Mac: an iOS
simulator and an Android emulator. Each step says which phone acts, what
to tap, and what the screen should say. It takes about 30 minutes with
funded wallets.

The two demo identities:

| Phone | Name | Pubky |
|---|---|---|
| iOS simulator (`PaykitWDK-iPhone17`) | Ana (iOS) | `pubkyp18qc8hqqs7exqohndch3zmxnzcrh3bfspqaaii8bgq6h46ksa5o` |
| Android emulator (`PaykitWDK_api36`) | Ben (Android) | `pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy` |

Below, `$ANA` and `$BEN` stand for those keys.

## Before you start

### Builds

Run the release builds (README, "Release builds"), so there is no
dev-tools button on screen and no Metro server is needed. Both apps open
straight into the saved identities on the Wallet tab.

Simulators can't scan each other's QR codes, so some steps open a screen
with a deep link from the Mac:

```sh
xcrun simctl openurl booted "paykitwdk://…"                          # Ana
adb shell am start -a android.intent.action.VIEW -d "paykitwdk://…"  # Ben
```

### Funding

Money moves in steps 2, 5, 6, 7, 8 and 9. Check both wallets first:

```sh
node scripts/fund-status.mjs --contacts 3
```

Each wallet needs:

| Asset | Amount | How |
|---|---|---|
| Sepolia ETH (gas) | 0.002 ETH or more | Ana's wallet is the treasury: a person sends it about 0.05 Sepolia ETH once from a public faucet. Then `node scripts/fund-eth.mjs android 0.002`. |
| USD₮ (Aave test token) | 1,000 | `node scripts/fund-usdt.mjs ios 1000` and `… android 1000`, or You > Test funds > "Get test USD₮" in the app. |
| Bitcoin (Mutinynet) | 200,000 sats | Once a day, a person runs `node scripts/fund-btc.mjs --login` (GitHub device login). Then `node scripts/fund-btc.mjs ios 200000` and `… android 200000`. |

Without funds, every step still runs up to the review screen, which says
"Not enough USD₮…" or "Not enough ETH for gas" instead of sending.

### Starting point

Both phones show the Wallet tab. On People, each lists the other with the
solid seal ring and "Private connection ready". Steps 2 and 4 remove and
add each other again, to show paying a stranger and the link forming.

## 1. Identities and profiles

Shows: one recovery phrase for both libraries, Pubky profiles.

1. **Ana:** open the You tab. The top shows her seal, "Ana (iOS)" and her
   pubky. "Your pay-me code" is her pubky as a QR code.
2. **Ana:** tap **Edit profile**, change the name or pick a photo, then
   **Publish my profile**. The seal now carries the photo.
3. **Ben:** open People. Within about ten minutes (the profile cache) or
   after a relaunch, Ana's row shows the new name and photo.

Say: WDK derives the Bitcoin and Ethereum keys from the recovery phrase;
Paykit derives the Pubky identity from the same phrase. The profile is
public data on Ana's homeserver.

## 2. Pay a stranger by pubky (public endpoints)

Shows: public payment endpoints, paying a person, not an address.

1. **Ana:** People > Ben (Android) > **Remove Ben (Android)**, confirm.
   **Ben:** People > Ana (iOS) > **Remove Ana (iOS)**, confirm. They are
   strangers now; their history stays, and so does Bitcoin in their
   contact accounts (still in You > Bitcoin from contacts). Automatic
   payments between them end.
2. **Ben:** You > What you publish. Bitcoin and USD₮ are both on. Tap
   **Check what others see**: it lists the two addresses anyone can pay.
3. **Ana:** Wallet > **Send** > **A person (pubky)**, paste `$BEN`
   (or `xcrun simctl openurl booted "paykitwdk://send?to=$BEN&asset=usdt"`).
   The payee card shows Ben's seal and name with "Not in your contacts:
   this is the name they gave themselves", "Accepts Bitcoin and USD₮ by
   pubky" and "USD₮ goes to 0x83A8…".
4. Type 1 USD₮, **Review**. The review says "The public address they
   publish for everyone:" above Ben's address, and the network fee in ETH
   (on Sepolia usually "less than 0.000001 ETH"). **Send 1.00 USD₮**.
5. **Ben:** Wallet. The USD₮ balance grows within 15 seconds. The
   "Received" row follows once Blockscout lists the transfer, which can
   take a minute or two.

Paying Bitcoin the same way goes to Ben's main address
(`tb1qx06…`), the one he publishes; once they are contacts again (step
3), Bitcoin goes to an address only Ana knows.

Try switching USD₮ off on Ben's What you publish: Ana's Send then says
"Ben (Android) doesn't accept USD₮ by pubky. Choose Bitcoin instead."
Switch it back on.

## 3. Add a contact and watch the link form

Shows: contacts, the Encrypted Link handshake, the seal closing.

1. **Ana:** `xcrun simctl openurl booted "paykitwdk://contact?pubky=$BEN"`
   (or People > Add > paste). Add person shows Ben's seal, name, short key
   and what he accepts publicly. Tap **Add Ben (Android)**.
2. Ana's Person page says "They haven't added you yet" with a dashed ring.
3. **Ben:** `adb shell am start -a android.intent.action.VIEW -d "paykitwdk://contact?pubky=$ANA"`,
   then **Add Ana (iOS)**.
4. Watch both Person pages: "Connecting privately…" with a rotating dashed
   ring, then the dashes join into a solid ring with a small envelope and
   a light haptic: "Private connection ready". This takes a few sync
   rounds (3 seconds each); in the funded run it took about 25 seconds.

## 4. Private payment lists

Shows: each phone shares a Private Payment List over the link.

1. **Ana:** on Ben's Person page, "What they accept" now has two lines:
   "Private addresses shared with you" (Ben's Bitcoin address only for
   Ana, and his USD₮ address) and "Your private addresses shared with
   them".
2. **Ana:** You > Network details counts the lists shared each way.

Say: Ben's wallet gave Ana a Bitcoin address no one else has (its own WDK
account for Ana). USD₮ uses one address for everyone, because each EVM
account would need its own gas.

## 5. Pay a contact, both ways, both assets

Shows: paying through private endpoints; the payment adapter and address
cache.

1. **Ana:** Person > **Pay Ben (Android)** > Bitcoin, 10,000 sats,
   **Review**. Review says "A Bitcoin address Ben (Android) shared only
   with you. Nobody else knows it is theirs." Send it.
2. **Ana:** Pay Ben again in USD₮, 2 USD₮. Review says "Ben (Android)'s
   USD₮ address. It is the same one everyone pays, so this payment is not
   private." Send it.
3. **Ben:** pay Ana 5,000 sats and 1 USD₮ the same way.
4. **Both:** Wallet activity names the person, with their seal: "You paid
   Ben (Android)" for both assets, and "Ana (iOS) paid you" for Bitcoin.
   A USD₮ payment from a contact reads "Received": it arrives at your one
   Ethereum address, and the sender's address in their list proves
   nothing (they could list anyone's address).
5. **Both:** under the Bitcoin balance, "Plus … BTC from contacts.
   Collect it to spend it": Bitcoin from a contact lands in your own
   account for them, not in the balance Send spends.

## 6. Collect

Shows: per-contact Bitcoin accounts.

1. **Ben:** Wallet. Under the Bitcoin balance: "Plus … from contacts.
   Collect it to spend it."
2. **Ben:** Ana's Person page > "Bitcoin from Ana (iOS)" > **Collect**
   (or You > Bitcoin from contacts). It says "Moving to your main account.
   It arrives with the next block." Activity shows one row, "Moved to main
   account, Bitcoin, from Ana (iOS)'s account", and the BTC balance grows
   by the whole amount less the network fee. The contact account is empty
   and the "from contacts" line goes away.
3. **Ana:** the same from Ben's Person page.

A contact account holding less than 436 sats can't be collected (it would
all go to the fee): its Collect button is disabled with "Too little to
move: it would all go to the network fee.", and the Wallet tab leaves it
out.

## 7. One-time request: proof, verification, receipt

Shows: payment requests, the payment ledger, payment proofs, receipts.

1. **Ben:** Requests > **Request money** (or
   `paykitwdk://request-money?pubky=$ANA`). Choose Ana, USD₮, 3, note
   "Lunch", expiry 1 hour, One time. **Request 3 USD₮ from Ana (iOS)**.
   The sheet says "Sent to Ana (iOS)".
2. **Ana:** Requests > Incoming shows Ben's request, "Waiting for you".
   Open it. The timeline shows Requested.
3. **Ana:** **Accept and pay**. The Send review opens with the amount and
   the address locked, "Paying accepts Ben (Android)'s request". Pay.
4. **Ana:** the timeline moves through Accepted and Paid (the proof: for
   USD₮ an EIP-712 signature that waits for the block).
5. **Ben:** the request page shows Paid, then Verified once his wallet
   checked the transfer on chain, then Receipt.
6. **Ana:** the Receipt step completes when the encrypted receipt
   arrives. Activity says "Receipt from Ben (Android)"; Ben's says "Paid
   your request, receipt sent". Open the row: Activity detail links to the
   request and the receipt.

Also try: **Decline** on another request (Ben's page says Declined, in
Graphite, not red), and **Cancel request** from Ben's side.

## 8. Recurring request

Shows: recurring billing periods (the wallets schedule; Paykit carries the
terms).

1. **Ben:** Request money from Ana: Bitcoin, 2,000 sats, **Every
   minute**, 3 payments. The schedule line says when each payment is due.
2. **Ana:** open it, **Accept and pay the first one**. A minute later the
   next period is due: the page says "Waiting for you. Every minute, one
   payment due now." Pay it, or tap **Not now** to put it off.
3. Either side can stop: **Stop these payments** (Ana) or **Cancel
   request** (Ben).

## 9. Automatic payments (Allowances)

Shows: Allowances, automatic acceptance and payment within limits.

1. **Ana:** Ben's Person page > Automatic payments > **Set up automatic
   payments**. Choose 5 USD₮ a payment and 1 day. Your limits read "From
   0.50 USD₮ to 5.00 USD₮ a payment. At most 10 payments and 20.00 USD₮
   an hour. 50.00 USD₮ in all. Until …". **Offer to Ben (Android)**.
2. **Ben:** Ana's Person page says "Ana (iOS) offers to pay your requests
   automatically". **Accept automatic payments**. Ana's page shows the
   limits with 0 used; Ben's shows the limits.
3. **Ben:** request 1 USD₮ from Ana, Every minute, 3 payments. His
   request page says "Ana (iOS) pays requests like this automatically."
4. **Ana:** don't touch anything. Within a few seconds the request is
   accepted and the first payment is sent; each minute the next one is
   paid. The request page says "Paid automatically within your limits
   for Ben (Android) as payments come due.", rows say "Paid
   automatically", and the Person page shows the usage.
5. Outside the limits, the request waits for Ana and says why. A request
   for more than 5 USD₮: "Outside the amount you allowed for one
   automatic payment, so it waits for you." A recurring request whose
   next payment would pass 20 USD₮ in an hour: "Not paid automatically.
   It would go over your hourly limit for automatic payments. You can pay
   it yourself."
6. **Either:** **Stop automatic payments** (Ana) or **End automatic
   payments** (Ben), each after a confirmation.

## 10. Block and unblock

Shows: blockPeer, unblockPeer, forgetPeer.

1. **Ana:** Ben's Person page > **Block Ben (Android)**, confirm. Ben moves
   under "Blocked" on People with a grey dashed ring. His requests and
   messages are ignored, and automatic payments between them end (Ben's
   page shows them ended once the End message arrives).
2. **Ana:** **Forget what they sent** says, in grey, "You and Ben
   (Android) have requests, payments or automatic payments together, so
   that history is kept. They stay blocked."
3. **Ana:** **Unblock Ben (Android)**. About 30 seconds later the ring is
   solid again, "Private connection ready". Automatic payments stay ended:
   set them up again to use them.

## 11. Backup of contacts and requests

Shows: exportBackupString, sealed with a key from the recovery phrase;
restoreBackupString into a throwaway handle.

1. **Ana:** You > Contacts and requests backup > **Back up contacts and
   requests** > **Copy backup**. "Backup copied. Paste it somewhere safe,
   such as a note or a file." The status line then says "Last backup just
   now. Nothing changed since then." While the backup is held,
   screenshots of the app come out blank. (Share works too; on Android
   the app can't tell whether you saved it, so it asks.)
2. **Ana:** **Check a copied backup**: "This backup opens with your
   recovery phrase and holds 1 contact, … requests and … receipts."
   Nothing on the phone changes.
3. Clear the clipboard afterwards (copy something else).

The real restore is on onboarding's sign-in step of a restored wallet
("Paste a backup"). It needs a phone with no state for the identity, so it
is not part of this run. After a restore, requests from the backup are
paid by hand, and if the backup held automatic payments they stay paused
until you check Activity and tap **Resume automatic payments** in You.

## 12. Network details

Shows: the Paykit and Noise layer, for developers.

1. **Ana:** You > Network details: homeserver, Paykit app registry, the
   Noise key, endpoints, lists shared each way, each contact's Encrypted
   Link recovery markers, and the backup revisions.
2. **Ana:** You > Sync status: the 3-second sync loop, its last round and
   the event log.

## Troubleshooting

- **A USD₮ "Received" row is late**: the balance comes from the chain,
  the row from Blockscout, which can list a transfer a minute or two after
  its block. The sender's own row turns from Pending to "just now" sooner,
  from the transaction receipt.
- **A step hangs at "Connecting privately…"**: both apps must be in the
  foreground; Paykit only moves messages while both poll.
- **"Couldn't load Bitcoin history. We'll keep trying."**: Mutinynet's
  Electrum server dropped the connection several polls in a row. The app
  reconnects by itself; older data stays on screen.
- **Never reload a dev build** with Cmd-R or the dev menu: relaunch it
  cold (README). Release builds have no dev menu.

## Funded run, 27 October 2026

The payment steps ran with real testnet money on both phones, in this
order: paying by address, steps 5 and 6, the in-app mint, step 2 after
removing each other, step 3, then step 5 again once linked. Every
transaction, so you can check it on the explorers:

| Step | What | Transaction |
|---|---|---|
| Address payment | Ana → Ben, 10,000 sats to his address | [cc2a38bc…](https://mutinynet.com/tx/cc2a38bce7b89e3b6f47f112492d4050a083ec56858378af6b8cc6eeed8cb218) |
| Address payment | Ben → Ana, 2 USD₮ to her address | [0xa9730d…](https://sepolia.etherscan.io/tx/0xa9730dd892ba07bc501992d088c50e53ef43045059c926705e065aa40b62560c) |
| 5. Pay a contact | Ana → Ben, 10,000 sats to his account for Ana | [3cb2657e…](https://mutinynet.com/tx/3cb2657e83c592380cf3f5f2ac6ddf4f2d42abeb5e91a086aa708f9f5bf2b367) |
| 5. Pay a contact | Ana → Ben, 2 USD₮ | [0xab6914…](https://sepolia.etherscan.io/tx/0xab69145da1d2aaf942e2b78f2e33ed3f2c3b97e1a93921dcb354ad1cc79e583f) |
| 5. Pay a contact | Ben → Ana, 5,000 sats to her account for Ben | [fc604633…](https://mutinynet.com/tx/fc604633222475dce24eedd621e4b498da8b32936adf3d4606dad2f88b87d563) |
| 5. Pay a contact | Ben → Ana, 1 USD₮ | [0x38ebf1…](https://sepolia.etherscan.io/tx/0x38ebf1316b0d765ec2066941fc0e3a32afda11c1ecc84a54f8f988f20369aafe) |
| 6. Collect | Ben, before the fix: 9,559 sats moved, 300 left behind | [2694c57a…](https://mutinynet.com/tx/2694c57a1d001c2e7915d083ad5f4b385278850b68cf91ee493a278353c6f6f4) |
| Test funds | Ben, "Get 1,000 test USD₮" | [0x867d31…](https://sepolia.etherscan.io/tx/0x867d312e09714c096c6706579ce59197b76e25cef0115e0ea81002ef247ec303) |
| 2. Pay a stranger | Ana → Ben by pubky, 1 USD₮ (public endpoint) | [0xd43c63…](https://sepolia.etherscan.io/tx/0xd43c633202eeca79fd5263fa53724d7bcb58110d8f27e9679a5b7459b46a3406) |
| 2. Pay a stranger | Ana → Ben by pubky, 5,000 sats to his public address | [bfdf88c2…](https://mutinynet.com/tx/bfdf88c2217cad97f2d75cf711da17fed1ac7c2510d46772d907827e261c4974) |
| 6. Collect | Ana, after the fix: all 5,000 sats less the fee, one output | [ac032666…](https://mutinynet.com/tx/ac03266616224d2ca10c64778c44f8ff33b7d34d4707566dd3aca1c556abe490) |
| 5. Pay a contact | After re-adding (step 3): Ana → Ben, 5,000 sats, to the same account for Ana | [f738accd…](https://mutinynet.com/tx/f738accd40f12d3f6239d90d882f6a2f04d0a274dac9e3e6a7f44315ad8288dc) |
| 5. Pay a contact | After re-adding: Ben → Ana, 1 USD₮ | [0xb160f0…](https://sepolia.etherscan.io/tx/0xb160f03e87ba6b4578f952e109d68d2d99b3fe90ea9327bbbceadcb7bd233ce5) |
| 6. Collect | Ben, after the fix: 5,000 sats plus the 300 left before, one output | [26fae892…](https://mutinynet.com/tx/26fae89216845111c8bc0dcff004bed2d9859a5f9d5d9877cefe32def58a56ba) |

Screenshots of the run are in
[`screenshots/demo-run/`](screenshots/demo-run/).
