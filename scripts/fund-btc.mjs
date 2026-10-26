#!/usr/bin/env node
// Get Mutinynet sats from the Mutinynet faucet's API.
//
//   node scripts/fund-btc.mjs --login           one-time GitHub device login, saves a 24 h faucet token
//   node scripts/fund-btc.mjs ios               100,000 sats to the iOS wallet
//   node scripts/fund-btc.mjs android 50000
//   node scripts/fund-btc.mjs tb1q… 20000
//
// The faucet (faucet.mutinynet.com, source: MutinyWallet/mutinynet-faucet-rs)
// needs a Bearer JWT, valid for 24 hours, that it issues after a GitHub
// login. `--login` runs GitHub's device flow with the faucet's OAuth app:
// you open github.com/login/device, type the code it prints, and the script
// stores the faucet JWT as MUTINYNET_FAUCET_TOKEN in the git-ignored
// .env.demo. The token is never printed. The GitHub token itself is used
// once and not stored. Limit: 1,000,000 sats per GitHub user and IP per day.
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MUTINYNET_EXPLORER, MUTINYNET_FAUCET, ROOT, readDemoEnv, resolveTarget } from './lib/demo-wallets.mjs';

/** The faucet's GitHub OAuth app (GET https://faucet.mutinynet.com/auth/github/client_id). */
const GITHUB_CLIENT_ID = 'Ov23liIa6qfR9KtYHwUF';
const MAX_SATS = 1_000_000;

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text.slice(0, 200) };
  }
  return { ok: response.ok, status: response.status, json };
}

function saveToken(token) {
  const envPath = join(ROOT, '.env.demo');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const kept = lines.filter((line) => !/^\s*MUTINYNET_FAUCET_TOKEN\s*=/.test(line));
  writeFileSync(envPath, kept.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  appendFileSync(envPath, `MUTINYNET_FAUCET_TOKEN=${token}\n`);
  chmodSync(envPath, 0o600);
}

async function login() {
  const device = await postJson('https://github.com/login/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'user:email' });
  if (!device.ok || !device.json.device_code) throw new Error(`GitHub refused the device login (${device.status}).`);
  const { device_code: deviceCode, user_code: userCode, verification_uri: uri, interval = 5, expires_in: expiresIn } = device.json;
  console.log(`Open ${uri} and enter the code ${userCode} (valid ${Math.round(expiresIn / 60)} minutes). Waiting…`);

  let pollSeconds = interval;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
    const poll = await postJson('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (poll.json.access_token) {
      const exchange = await postJson(`${MUTINYNET_FAUCET}/auth/github/device`, { code: poll.json.access_token });
      if (!exchange.ok || !exchange.json.token) throw new Error(`The faucet refused the GitHub login (${exchange.status}).`);
      saveToken(exchange.json.token);
      console.log('Saved MUTINYNET_FAUCET_TOKEN to .env.demo (valid for 24 hours).');
      return;
    }
    if (poll.json.error === 'slow_down') pollSeconds += 5;
    else if (poll.json.error !== 'authorization_pending') throw new Error(`GitHub login failed: ${poll.json.error}`);
  }
}

async function fund(targetArg, satsArg) {
  const token = readDemoEnv().MUTINYNET_FAUCET_TOKEN;
  if (!token) throw new Error('MUTINYNET_FAUCET_TOKEN is not set. Run: node scripts/fund-btc.mjs --login');
  const address = resolveTarget(targetArg, 'btc');
  const sats = Number(satsArg);
  if (!Number.isInteger(sats) || sats < 1_000 || sats > MAX_SATS) throw new Error('Ask for between 1,000 and 1,000,000 sats.');

  console.log(`Asking the Mutinynet faucet for ${sats} sats to ${address}…`);
  const result = await postJson(`${MUTINYNET_FAUCET}/api/onchain`, { sats, address }, { authorization: `Bearer ${token}` });
  if (result.status === 401) throw new Error('The faucet token was refused (it lasts 24 hours). Run: node scripts/fund-btc.mjs --login');
  if (!result.ok || !result.json.txid) throw new Error(`The faucet answered ${result.status}: ${result.json.error ?? 'no txid'}`);
  console.log(`Sent ${result.json.txid}: ${MUTINYNET_EXPLORER}/tx/${result.json.txid}`);
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--login') await login();
  else if (args[0]) await fund(args[0], args[1] ?? '100000');
  else {
    console.error('Usage: node scripts/fund-btc.mjs --login | <ios|android|tb1…> [sats, default 100000]');
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
