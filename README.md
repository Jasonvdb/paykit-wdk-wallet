# Paykit × WDK example wallet

A React Native example wallet that shows how [Tether WDK](https://wdk.tether.io/)
and [Pubky Paykit](https://github.com/pubky/paykit-rs) work together:

- **WDK** holds the keys and moves the money (testnet only).
- **Paykit** turns Pubky identities into payable contacts: public and private
  payment endpoints, payment requests and more.

> **Testnet only. Not production software.** This repository is a reference for
> developers. Keys are stored with simple demo-grade protection.

## Status

Work in progress. The plan and research notes live in [`docs/`](docs/).

## Paykit package

Paykit's React Native bindings come from the unmerged
[paykit-rs PR #204](https://github.com/pubky/paykit-rs/pull/204). They are not
on npm yet, so `scripts/build-paykit.sh` builds them from a pinned commit and
packs `vendor/synonymdev-react-native-paykit.tgz`.
