# Design

## The idea: pay people, not addresses

Most wallets are built around assets and addresses. Paykit changes the
subject: you pay a **person**, identified by their Pubky key, and the wallet
works out the address. Paykit's private traffic also behaves like
correspondence. Two wallets seal an Encrypted Link, and from then on they
exchange private payment lists, requests, proofs and receipts. Each message is
dropped on a homeserver and picked up by the other side.

So the design is built around **correspondents**, and its one bold element is
the **seal**: a mark generated from each person's key that shows the state of
your link with them.

Everything else stays quiet: plain rows, generous spacing, one family for
reading.

## Tokens

### Color

| Name | Hex | Use |
|---|---|---|
| Paper | `#EEF1F4` | App background. A cool, slightly blue off-white, like airmail paper. |
| Sheet | `#FFFFFF` | Raised surfaces: sheets, inputs, the receive card. |
| Ink | `#18233A` | Primary text and primary buttons. A navy ink, not black. |
| Graphite | `#5D6778` | Secondary text, hints, inactive icons. |
| Rule | `#D5DBE3` | Dividers and input outlines. |
| Seal | `#3D3BBF` | Identity and Paykit: seals, link states, "private" markers, focus rings. |
| Tether | `#1F9D7A` | USD₮ only. |
| Amber | `#C98404` | Bitcoin only. |
| Alert | `#B42318` | Errors and destructive actions only. |

The asset colors are information, not decoration. They appear only next to
that asset: its dot, its amount and its chart line. Seal is the only accent for
the app itself.

Dark mode is out of scope for the demo.

### Type

- **Bricolage Grotesque** (display): amounts, screen titles, a contact's name
  on their page. Amounts are large, set at weight 600 with tight letter
  spacing. The amount is the headline of any money screen.
- **Atkinson Hyperlegible Next** (text): all body copy, buttons and labels. It
  was designed to keep confusable characters apart (`0/O`, `1/l/I`). That
  matters in a wallet.
- **Atkinson Hyperlegible Mono**: only for keys, addresses and transaction
  hashes. It is used because these strings are copied and compared character
  by character, not as a stylistic data label.

Scale (pt): 44 / 30 / 22 / 17 / 15 / 13. Body is 17 with 1.4 line height.
Sentence case everywhere. No all-caps labels and no tracked eyebrows.

### Shape and space

- Spacing on a 4 pt grid: 4, 8, 12, 16, 24, 32, 48.
- The radius follows hierarchy: sheets 20, buttons 14, inputs 12, chips are
  fully round. The seal is a circle.
- No drop shadows on rows. Sheets and modals get one soft, cool shadow
  (`#18233A` at 8%).
- Screen content is left aligned, with a 20 pt side margin. Only the receive
  card (QR) is centered.

## The seal

Every person has a seal: a circle filled with a 4×4 pattern of quarter-circle
tiles. Tile rotation and the two tile tones come from bytes of their Pubky
key, so the same person always gets the same seal on both phones. If the
person has a profile picture, it sits inside the seal ring.

The ring shows the link state:

| State | Ring |
|---|---|
| Not a contact | No ring. |
| Contact, linking | A dashed Seal-colored ring that rotates slowly while the handshake runs. It respects reduce motion. |
| Linked | A solid Seal ring, plus a small closed-envelope badge. |
| Peer unreachable or blocked | A Graphite dashed ring. |

The moment the ring closes, after both sides add each other, is the app's one
orchestrated animation: the dashes join into a solid ring over 400 ms with a
light haptic.

## Screen map

```
Onboarding (stack)
  Welcome            "A testnet wallet where you pay people, not addresses."
  Create / Restore   generate a phrase, or paste one
  Invite code        staging signup code (prefilled in dev builds); a restored
                     wallet signs in instead and can "Paste a backup" of its
                     contacts and requests
  Your name          display name and optional photo -> publishes profile
  Ready              your seal, your pubky, "Add someone" / "Go to wallet"

Tabs
  Wallet
    balances: BTC row, USD₮ row (+ ETH gas as a quiet line under USD₮)
    actions: Send, Receive, Request
    activity: on-chain transactions + Paykit requests/receipts, newest first
  People
    list of contacts (seal, name, link state in words)
    Add person: paste pubky, scan QR, or open a paykitwdk:// link
    Person: seal + name, link state, what they accept (public / private),
            Pay, Request, your name for them, automatic payments (limits
            and usage both ways, Accept / Decline / Stop, "Set up automatic
            payments"), history with them, Bitcoin from them (Collect),
            Block / Unblock / Forget / Remove. Blocked: no Pay or Request.
  Requests
    Incoming / Sent segments, each row a request with its status
    Request detail: amount, asset, note, due date, recurring schedule,
                    a vertical status timeline:
                    Requested -> Accepted -> Paid (proof) -> Verified -> Receipt
  You
    profile (name, photo), your pubky + QR, what you publish publicly
    (BTC / USD₮ toggles), recovery phrase (reveal), test funds
    ("Get test USD₮"), Bitcoin from contacts, contacts and requests
    backup (make, Copy or Share, check a copied one; resume automatic
    payments after a restore), network details, sync status and log

Modals
  Send:    To (person or address) -> asset -> amount -> review fee -> sent
  Receive: asset picker, address QR, and "Your pay-me code" (pubky QR)
  Request: person -> asset -> amount -> note, expiry, repeat
  Automatic payments: asset -> most per payment -> ends after -> the
           limits in words -> "Offer to Ben" (one open offer at a time)
```

Wireframe of the wallet tab:

```
┌──────────────────────────────┐
│ (seal) Ana                   │  you, tap -> You tab
│                              │
│ ● BTC          0.004 21  BTC │  Amber dot
│ ● USD₮               250.00  │  Tether dot
│   gas 0.018 ETH              │  Graphite, small
│                              │
│ [ Send ] [ Receive ] [Request]│  Ink filled, Sheet, Sheet
│                              │
│ Activity                     │
│ (seal) Ben paid you  +12 USD₮│
│        Receipt issued, 2m ago│
│ (seal) You → Ben   −0.001 BTC│
│        Confirmed, 1h ago     │
└──────────────────────────────┘
```

## Writing

- Name things the way a user would. "Link" means the private connection with a
  contact. "Paykit" and "Noise" never appear in the main UI; they appear in
  You > Network details, because this is a developer reference. The one
  exception is the Welcome screen, which names the two SDKs once to say what
  this reference app shows.
- Error text never shows SDK tags or codes. Screens use `userMessageFor`
  (src/paykit/errors.ts); the raw error goes to the event log.
- Link states in words: "Connecting privately…", "Private connection ready",
  "They haven't added you yet", "Can't reach them right now".
- Buttons say what happens: "Send 12 USD₮", "Pay request", "Add Ana",
  "Publish my profile".
- Errors say what happened and what to do: "Not enough USD₮. You have 4.20."
  "Couldn't reach Ana's homeserver. We'll keep trying."
- Every screen with nothing to show offers the next action: "No requests yet.
  Ask a contact for money".
- Write status lines as sentences, not as fragments joined by a middle dot
  ("Waiting for you. Every minute, one payment due now.", not "Waiting for
  you · every minute · payment due now"). A note goes on its own line.
- Alert red means something went wrong. A request that was declined,
  canceled or expired ended the normal way, so it is Graphite, not Alert.
- Mark testnet clearly but quietly: one persistent "Testnet" chip in the
  header, never a scary banner.

## Review against generic defaults

- Palette: cool airmail paper and navy ink with one indigo accent. It avoids
  the cream-and-terracotta and black-and-acid-green defaults. Asset colors are
  functional and scoped.
- Layout: rows and dividers instead of a grid of identical rounded cards. Card
  treatment is kept for the receive card and modals only.
- Type: monospace is limited to strings people compare character by
  character. Hyperlegible was chosen for address legibility, not as a style.
- Motion: one orchestrated moment, the seal closing. Everything else animates
  only in response to a tap.
