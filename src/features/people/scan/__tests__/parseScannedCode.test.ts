import { SEPOLIA_USDT } from '../../../../config/chains';
import { contactLinkFor } from '../../../../paykit/keys';
import { MAX_CODE_LENGTH, parseScannedCode } from '../parseScannedCode';

const BEN = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';
const BTC = 'tb1qx06yqnsvfwu36p0gz8ps7rfufeahnxl3m4c2v6';
const EVM = '0x83A881Ddad0F675A3d57d306F3F4E6b352b95CD0';

describe('parseScannedCode: people', () => {
  it('reads a pay-me code (contact link) and a bare pubky', () => {
    expect(parseScannedCode(contactLinkFor(BEN))).toEqual({ kind: 'person', pubky: BEN });
    expect(parseScannedCode(BEN)).toEqual({ kind: 'person', pubky: BEN });
    expect(parseScannedCode(`pk:${BEN.slice(5)}`)).toEqual({ kind: 'person', pubky: BEN.slice(5) });
  });

  it('refuses a contact link without a valid key', () => {
    expect(parseScannedCode('paykitwdk://contact?pubky=nope').kind).toBe('unsupported');
    expect(parseScannedCode(`paykitwdk://contact?pubky=${BEN}&then=evil`).kind).toBe('unsupported');
  });
});

describe('parseScannedCode: payments', () => {
  it('reads Bitcoin test addresses and BIP-21 URIs, ignoring the amount', () => {
    expect(parseScannedCode(BTC)).toEqual({ kind: 'pay', to: BTC, asset: 'btc' });
    expect(parseScannedCode(`bitcoin:${BTC}?amount=0.5&label=x`)).toEqual({ kind: 'pay', to: BTC, asset: 'btc' });
  });

  it('refuses mainnet Bitcoin with the reason', () => {
    const result = parseScannedCode('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(result).toEqual({ kind: 'unsupported', message: expect.stringMatching(/mainnet/) });
  });

  it('reads Ethereum addresses and EIP-681 URIs on Sepolia', () => {
    expect(parseScannedCode(EVM)).toEqual({ kind: 'pay', to: EVM, asset: 'usdt' });
    expect(parseScannedCode(`ethereum:${EVM}`)).toEqual({ kind: 'pay', to: EVM, asset: 'usdt' });
    expect(parseScannedCode(`ethereum:${EVM}@11155111`)).toEqual({ kind: 'pay', to: EVM, asset: 'usdt' });
  });

  it('refuses other Ethereum networks', () => {
    expect(parseScannedCode(`ethereum:${EVM}@1`)).toEqual({ kind: 'unsupported', message: expect.stringMatching(/another Ethereum network/) });
  });

  it('pays the payee of a USD₮ transfer request, never the token contract', () => {
    expect(parseScannedCode(`ethereum:${SEPOLIA_USDT}@11155111/transfer?address=${EVM}&uint256=1000000`)).toEqual({
      kind: 'pay',
      to: EVM,
      asset: 'usdt',
    });
    expect(parseScannedCode(`ethereum:0x1111111111111111111111111111111111111111@11155111/transfer?address=${EVM}`).kind).toBe(
      'unsupported',
    );
    expect(parseScannedCode(`ethereum:${SEPOLIA_USDT}@11155111/approve?address=${EVM}`).kind).toBe('unsupported');
  });

  it('reads paykitwdk://send links to a pubky or an address', () => {
    expect(parseScannedCode(`paykitwdk://send?to=${BEN}&asset=usdt`)).toEqual({ kind: 'pay', to: BEN, asset: 'usdt' });
    expect(parseScannedCode(`paykitwdk://send?to=${encodeURIComponent(BTC)}`)).toEqual({ kind: 'pay', to: BTC, asset: 'btc' });
    expect(parseScannedCode(`paykitwdk://send?to=${BTC}&asset=usdt`).kind).toBe('unsupported');
    expect(parseScannedCode('paykitwdk://send?to=somewhere').kind).toBe('unsupported');
  });
});

describe('parseScannedCode: everything else', () => {
  it('refuses other links, text, empty and oversized codes', () => {
    expect(parseScannedCode('paykitwdk://you').kind).toBe('unsupported');
    expect(parseScannedCode('https://example.com').kind).toBe('unsupported');
    expect(parseScannedCode('hello')).toEqual({ kind: 'unsupported', message: "This code isn't a pubky or a test-network payment address." });
    expect(parseScannedCode('  \n ').kind).toBe('unsupported');
    expect(parseScannedCode(`${BEN}${' '.repeat(MAX_CODE_LENGTH)}x`).kind).toBe('unsupported');
  });

  it('strips control characters around the code', () => {
    expect(parseScannedCode(`\u0000${BEN}\u0007`)).toEqual({ kind: 'person', pubky: BEN });
  });
});

describe('parseScannedCode and contracts', () => {
  it('never pays the token or faucet contract', () => {
    expect(parseScannedCode(SEPOLIA_USDT).kind).toBe('unsupported');
    expect(parseScannedCode(`ethereum:${SEPOLIA_USDT}@11155111`).kind).toBe('unsupported');
    expect(parseScannedCode(`paykitwdk://send?to=${SEPOLIA_USDT}`).kind).toBe('unsupported');
  });
});

describe('parseScannedCode and shared pay-me messages', () => {
  it('reads the pubky out of a pasted Share message', () => {
    const message = `Ben in the test wallet. Paste this in Send to pay me, or open the link to add me:\n${contactLinkFor(BEN)}\n${BEN}`;
    expect(parseScannedCode(message)).toEqual({ kind: 'person', pubky: BEN });
  });
});
