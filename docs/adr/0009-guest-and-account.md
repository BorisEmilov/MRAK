# ADR 0009 — Guest play and accounts

- Status: proposed
- Date: 2026-11-17
- Back to [threat model](../security/threat-model.md) · [data inventory](../security/data-inventory.md)

## Context

The game must be playable immediately, offline, without giving personal data. Accounts add cloud
saves, cross-device progress and purchases, and each account costs us storage, email and support.

## Decision

- **Guest is the default.** Saves, the Bloodline profile (achievements, Legacy, stats) and the
  progress outbox live only in the browser. Guests create **no server state**: no guest tokens,
  no anonymous server profiles, so bots cannot create server rows without registering.
- **Account (optional)** = verified email + password. Required for cloud saves, cross-device
  progress, purchases and paid downloads. Unverified accounts can sign in but cannot use those
  features and are deleted after 7 days.
- **Upgrading a guest:** after the first sign-in on a device the local profile is merged into the
  account (`mergeProfiles`: union of unlocks, earliest timestamps, max counters) and queued
  progress is sent; local saves can be uploaded slot by slot. Nothing is sent before sign-in.
- **Signing out** keeps local guest data on the device; account data is not cached beyond what
  the game needs.
- **Deletion** removes the account and server data (7-day grace), never the local guest data.
- Server-side limits per account (saves, progress rows, downloads) bound the cost of each account.

## Consequences

- ✔ Zero personal data for most players; GDPR scope limited to account holders.
- ✔ Bot traffic against guest play costs only static CDN bandwidth.
- ✘ Guests lose data if they clear the browser — the UI says so and offers save export.
- ✘ Merge rules must be idempotent and tested (existing `mergeProfiles` tests).

## Alternatives considered

- Anonymous server accounts for guests: makes bot-created rows free; rejected.
- Social login only: depends on third parties and adds tracking concerns; may be added later as an
  extra authenticator.
