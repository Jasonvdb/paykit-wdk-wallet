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

Money moves in steps 3, 6, 7, 8, 9 and 10. Check both wallets first:

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
   strangers now; their history stays.
2. **Ben:** You > What you publish. Bitcoin and USD₮ are both on. Tap
   **Check what others see**: it lists the two addresses anyone can pay.
3. **Ana:** Wallet > **Send** > **A person (pubky)**, paste `$BEN`
   (or `xcrun simctl openurl booted "paykitwdk://send?to=$BEN&asset=usdt"`).
   The payee card shows Ben's seal and name with "Not in your contacts:
   this is the name they gave themselves".
4. Type 1 USD₮, **Review**. The review shows the address from Ben's public
   endpoint and the network fee in ETH. **Send 1 USD₮**.
5. **Ben:** Wallet. A "Received" USD₮ row appears after the next poll
   (15 seconds), once the block lands.

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
   rounds (3 seconds each).

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
4. **Both:** Wallet activity names the person: "You paid Ben (Android)",
   "Ana (iOS) paid you".

## 6. Collect

Shows: per-contact Bitcoin accounts.

1. **Ben:** Wallet. Under the Bitcoin balance: "Plus … from contacts.
   Collect it to spend it."
2. **Ben:** Ana's Person page > "Bitcoin from Ana (iOS)" > **Collect**
   (or You > Bitcoin from contacts). A "Moved to main account" row appears
   in Activity, and the BTC balance grows by almost the whole amount
   (WDK keeps back a dust-sized change output).

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
   payments**. Choose 5 USD₮ a payment and 1 day. The limits read: at most
   10 payments and 4 payments' worth an hour, 10 payments' worth in all.
   **Offer to Ben (Android)**.
2. **Ben:** Ana's Person page says "Ana (iOS) offers to pay your requests
   automatically". **Accept**. Both pages show the limits with 0 used.
3. **Ben:** request 1 USD₮ from Ana, Every minute, 3 payments. His
   request page says "Ana (iOS) pays requests like this automatically."
4. **Ana:** don't touch anything. Within a few seconds the request is
   accepted and the first payment is sent; each minute the next one is
   paid. The request page says "Paid automatically, within your limits
   for Ben (Android).", rows say "Paid automatically", and the Person page
   shows the usage.
5. Over a limit, the request waits for Ana and says why ("It would go over
   your hourly limit for automatic payments. You can pay it yourself.").
6. **Either:** **Stop automatic payments** (Ana) or **End** (Ben).

## 10. Block and unblock

Shows: blockPeer, unblockPeer, forgetPeer.

1. **Ana:** Ben's Person page > **Block Ben (Android)**, confirm. Ben moves
   under "Blocked" on People with a grey dashed ring. His requests and
   messages are ignored.
2. **Ana:** **Forget what they sent** says the history is kept: Ana and
   Ben have requested and paid each other, and the SDK keeps history you
   acted on.
3. **Ana:** **Unblock Ben (Android)**. About 30 seconds later the ring is
   solid again, "Private connection ready", and an accepted Allowance is
   still accepted.

## 11. Backup of contacts and requests

Shows: exportBackupString, sealed with a key from the recovery phrase;
restoreBackupString into a throwaway handle.

1. **Ana:** You > Contacts and requests backup > **Back up contacts and
   requests** > **Copy backup**. "Backup copied. Paste it somewhere safe,
   such as a note or a file." While the backup is held, screenshots of the
   app come out blank.
2. **Ana:** **Check a copied backup**: "This backup opens with your
   recovery phrase and holds 1 contact, … requests and … receipts."
   Nothing on the phone changes.
3. Clear the clipboard afterwards (copy something else).

The real restore is on onboarding's sign-in step of a restored wallet
("Paste a backup"). It needs a phone with no state for the identity, so it
is not part of this run.

## 12. Network details

Shows: the Paykit and Noise layer, for developers.

1. **Ana:** You > Network details: homeserver, Paykit app registry, the
   Noise key, endpoints, lists shared each way, each contact's Encrypted
   Link recovery markers, and the backup revisions.
2. **Ana:** You > Sync status: the 3-second sync loop, its last round and
   the event log.

## Troubleshooting

- **A step hangs at "Connecting privately…"**: both apps must be in the
  foreground; Paykit only moves messages while both poll.
- **"Couldn't load Bitcoin history. We'll keep trying."**: Mutinynet's
  Electrum server dropped the connection several polls in a row. The app
  reconnects by itself; older data stays on screen.
- **Never reload a dev build** with Cmd-R or the dev menu: relaunch it
  cold (README). Release builds have no dev menu.
