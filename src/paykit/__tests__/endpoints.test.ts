import { ENDPOINT_BTC, ENDPOINT_USDT } from '../../config/paykit';
import { SEPOLIA_USDT } from '../../config/chains';
import {
  PRIVATE_MESSAGE_LIMIT_BYTES,
  btcReceivingDetail,
  canonicalPayload,
  parseEndpoint,
  payableCandidateIds,
  usdtReceivingDetail,
  utf8ByteLength,
} from '../endpoints';

const EVM = '0x00000000000000000000000000000000000000aa';
const BTC = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

describe('endpoint payloads', () => {
  it('builds compact payloads that round-trip through the parser', () => {
    const usdt = usdtReceivingDetail(EVM);
    const btc = btcReceivingDetail(BTC);
    expect(JSON.parse(usdt.payload)).toEqual({ value: EVM, chain_id: '11155111', token: SEPOLIA_USDT });
    const parsedUsdt = parseEndpoint(usdt.identifier, usdt.payload);
    const parsedBtc = parseEndpoint(btc.identifier, btc.payload);
    expect(parsedUsdt?.asset).toBe('usdt');
    expect(parsedBtc).toEqual({ identifier: ENDPOINT_BTC, asset: 'btc', address: BTC });
    expect(canonicalPayload(parsedUsdt!)).toBe(usdt.payload);
    // Both endpoints together stay far below the private message limit.
    expect(utf8ByteLength(usdt.payload + btc.payload)).toBeLessThan(PRIVATE_MESSAGE_LIMIT_BYTES / 4);
  });

  it('rejects payloads for the wrong chain, token or address format', () => {
    const wrongChain = JSON.stringify({ value: EVM, chain_id: '1', token: SEPOLIA_USDT });
    const wrongToken = JSON.stringify({ value: EVM, chain_id: '11155111', token: '0x' + '1'.repeat(40) });
    expect(parseEndpoint(ENDPOINT_USDT, wrongChain)).toBeUndefined();
    expect(parseEndpoint(ENDPOINT_USDT, wrongToken)).toBeUndefined();
    expect(parseEndpoint(ENDPOINT_BTC, JSON.stringify({ value: 'bc1qmainnetaddress00000000000000000' }))).toBeUndefined();
    expect(parseEndpoint(ENDPOINT_BTC, 'not json')).toBeUndefined();
    expect(parseEndpoint('btc-bitcoin-p2wpkh', btcReceivingDetail(BTC).payload)).toBeUndefined();
  });

  it('accepts the token address in any letter case', () => {
    const lower = JSON.stringify({ value: EVM, chain_id: '11155111', token: SEPOLIA_USDT.toLowerCase() });
    expect(parseEndpoint(ENDPOINT_USDT, lower)?.asset).toBe('usdt');
  });

  it('orders payable candidates USD₮ first and drops unpayable ones', () => {
    const ids = payableCandidateIds([
      { candidateId: 'b', identifier: ENDPOINT_BTC, payloadText: btcReceivingDetail(BTC).payload },
      { candidateId: 'x', identifier: 'eur-sepa-iban', payloadText: '{"value":"DE00"}' },
      { candidateId: 'u', identifier: ENDPOINT_USDT, payloadText: usdtReceivingDetail(EVM).payload },
      { candidateId: 'bad', identifier: ENDPOINT_USDT, payloadText: '{"value":"0x12"}' },
    ]);
    expect(ids).toEqual(['u', 'b']);
  });
});
