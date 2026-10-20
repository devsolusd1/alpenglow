//! Chamada (roll call).
//!
//! One record per coin, at the PDA ["chamada", mint], 648 bytes. Two instructions:
//!
//! - `init` (0): the authority creates the record, with the size of the coin's grid (`rank_count`,
//!   the number of ranks in the genesis certificate's rank map; 0 means test mode) and `grid_hash`
//!   (sha256 over the ordered rank list, each entry vote pubkey || compressed BLS key, rank 0 first).
//!   The mint's own key must sign. Until the seal, init can be sent again (the mint signing again) to
//!   rewrite rank_count, grid_hash and authority; after the seal it is refused.
//! - `seal` (1): anyone, once. Copies Alpenglow's genesis certificate (the runtime-written System account
//!   42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1) into the record, counts its signers, and stores the
//!   slot it ran in and the parent slot (the newest SlotHashes entry). `first_block` is 1 when the parent
//!   is the certificate's own slot, which is only true in the first Alpenglow block. Not being first is
//!   never an error.
//!
//! The program does not verify the BLS signature (no BLS12-381 pairing on mainnet at a price a seal can
//! pay); it copies the bytes the runtime wrote, and the site checks the pairing in the browser.
//!
//! `parse` holds every byte rule as plain functions (host-tested in tests/host.rs); `processor` is the
//! on-chain glue (accounts, the System program CPI, Clock, the log line).

#![cfg_attr(target_os = "solana", no_std)]

pub mod parse;

#[cfg(target_os = "solana")]
pub mod processor;

#[cfg(target_os = "solana")]
mod entrypoint {
    // both instructions take 4 accounts; more are ignored
    pinocchio::program_entrypoint!(crate::processor::process_instruction, 4);
    pinocchio::no_allocator!();
    pinocchio::nostd_panic_handler!();
}
