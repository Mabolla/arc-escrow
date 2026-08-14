# Issue #33 implementation notes

The withdrawal flow uses the authenticated user's Supabase profile to resolve the corresponding Circle Developer Controlled Wallet. The client never supplies a source wallet ID.

Transfers are restricted to Arc Testnet USDC, validate the destination for `ARC-TESTNET`, enforce positive amounts with at most 6 decimal places, check the current USDC balance server-side, and submit the Circle transfer with an idempotency key.

Circle webhook handling already refreshes the wallet balance after a completed transaction, and the transfer route records the Circle transaction in the application transaction history.
