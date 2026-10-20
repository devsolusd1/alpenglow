//! On-chain glue: accounts, the System program CPI that creates the record, Clock, the log line.
//! The byte rules live in `parse`.

use {
    crate::parse::*,
    pinocchio::{
        cpi::{invoke, invoke_signed, Seed, Signer},
        error::ProgramError,
        instruction::{InstructionAccount, InstructionView},
        sysvars::{clock::Clock, rent::Rent, Sysvar},
        AccountView, Address, ProgramResult,
    },
};

const SYSTEM: Address = Address::new_from_array(SYSTEM_PROGRAM);

#[inline(never)]
fn fail(code: u32) -> ProgramError {
    if code == err::BAD_INSTRUCTION_DATA {
        ProgramError::InvalidInstructionData
    } else {
        ProgramError::Custom(code)
    }
}

pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    match data {
        [0, ..] => init(program_id, accounts, data),
        [1] => seal(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// `init`: data [0] || rank_count u16 LE || grid_hash [32].
/// Accounts: 0 authority (signer, writable, pays), 1 record (writable, PDA ["chamada", mint]),
/// 2 mint (signer, read-only: the coin's own mint keypair signs; the account itself is not read, so the
/// record can be made before the mint exists), 3 System program.
/// Until the record is sealed, init can be sent again (signed by the same mint): it rewrites rank_count,
/// grid_hash and authority in place. After the seal it fails with ALREADY_SEALED.
fn init(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [authority, record, mint, system, ..] = &mut *accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let (rank_count, grid_hash) = parse_init_data(data).map_err(fail)?;
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if let Some(only) = INIT_AUTHORITY {
        if authority.address().as_array() != &only {
            return Err(fail(err::WRONG_INIT_AUTHORITY));
        }
    }
    if !mint.is_signer() {
        return Err(fail(err::MINT_MUST_SIGN));
    }
    if !authority.is_writable() || !record.is_writable() {
        return Err(fail(err::NOT_WRITABLE));
    }
    if system.address() != &SYSTEM {
        return Err(fail(err::WRONG_SYSTEM_PROGRAM));
    }
    let (expected, bump) = Address::find_program_address(&[SEED, mint.address().as_ref()], program_id);
    if record.address() != &expected {
        return Err(fail(err::WRONG_RECORD_ADDRESS));
    }
    if record.owned_by(program_id) {
        // a repeated init, before the seal: same mint (it signed), same PDA; rewrite the init fields
        let mut d = record.try_borrow_mut()?;
        let rec = <&mut [u8; RECORD_LEN]>::try_from(&mut *d).map_err(|_| fail(err::NOT_A_RECORD))?;
        check_record_for_reinit(rec, mint.address().as_array()).map_err(fail)?;
        write_init(rec, mint.address().as_array(), authority.address().as_array(), rank_count, grid_hash);
        return Ok(());
    }
    if !record.is_data_empty() {
        return Err(fail(err::ALREADY_INITIALIZED));
    }
    let bump_seed = [bump];
    let seeds = [Seed::from(SEED), Seed::from(mint.address().as_ref()), Seed::from(&bump_seed)];
    create_pda(authority, record, program_id, RECORD_LEN, &seeds)?;
    let mut d = record.try_borrow_mut()?;
    let rec = <&mut [u8; RECORD_LEN]>::try_from(&mut *d).map_err(|_| fail(err::NOT_A_RECORD))?;
    write_init(rec, mint.address().as_array(), authority.address().as_array(), rank_count, grid_hash);
    Ok(())
}

/// `seal`: data [1]. Accounts: 0 sealer (signer), 1 record (writable), 2 the genesis certificate account
/// 42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1 (read-only), 3 SlotHashes sysvar (read-only).
/// Permissionless, once per record.
fn seal(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [sealer, record, cert, slot_hashes, ..] = &mut *accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !sealer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !record.owned_by(program_id) {
        return Err(fail(err::NOT_A_RECORD));
    }
    if !record.is_writable() {
        return Err(fail(err::NOT_WRITABLE));
    }
    if slot_hashes.address().as_array() != &SLOT_HASHES_ID {
        return Err(fail(err::WRONG_SLOT_HASHES));
    }
    let parent = parent_slot(&slot_hashes.try_borrow()?);
    let seal_slot = Clock::get()?.slot;

    let mut line = [0u8; 160];
    let len;
    {
        let cd = cert.try_borrow()?;
        let mut rd = record.try_borrow_mut()?;
        let rec = <&mut [u8; RECORD_LEN]>::try_from(&mut *rd).map_err(|_| fail(err::NOT_A_RECORD))?;
        let rank_count = check_record_for_seal(rec).map_err(fail)?;
        let c = check_cert(cert.address().as_ref(), cert.owner().as_ref(), &cd, rank_count).map_err(fail)?;
        let first = first_block(parent, c.slot);
        let parent_slot = parent.unwrap_or(0);
        write_seal(rec, &c, seal_slot, parent_slot, first, sealer.address().as_array());
        len = seal_line(&mut line, c.slot, c.signer_count, c.bit_count, parent_slot, first);
    }
    // SAFETY: a plain log syscall over bytes we own.
    unsafe { pinocchio::syscalls::sol_log_(line.as_ptr(), len as u64) };
    Ok(())
}

/// Creates `target` (a PDA of this program) with `space` bytes, rent paid by `payer`. When someone has
/// already sent lamports to the address, tops it up, then allocates and assigns instead (CreateAccount
/// refuses a funded address). Same as Hunch's.
fn create_pda(payer: &AccountView, target: &AccountView, owner: &Address, space: usize, seeds: &[Seed]) -> ProgramResult {
    let rent = Rent::get()?.try_minimum_balance(space)?;
    let signer = [Signer::from(seeds)];
    let have = target.lamports();
    if have == 0 {
        let mut d = [0u8; 52];
        d[4..12].copy_from_slice(&rent.to_le_bytes());
        d[12..20].copy_from_slice(&(space as u64).to_le_bytes());
        d[20..52].copy_from_slice(owner.as_array());
        let metas = [InstructionAccount::writable_signer(payer.address()), InstructionAccount::writable_signer(target.address())];
        return invoke_signed::<2, &AccountView>(&InstructionView { program_id: &SYSTEM, data: &d, accounts: &metas }, &[payer, target], &signer);
    }
    if have < rent {
        let mut d = [0u8; 12];
        d[0] = 2;
        d[4..12].copy_from_slice(&(rent - have).to_le_bytes());
        let metas = [InstructionAccount::writable_signer(payer.address()), InstructionAccount::writable(target.address())];
        invoke::<2, &AccountView>(&InstructionView { program_id: &SYSTEM, data: &d, accounts: &metas }, &[payer, target])?;
    }
    let mut d = [0u8; 12];
    d[0] = 8;
    d[4..12].copy_from_slice(&(space as u64).to_le_bytes());
    let metas = [InstructionAccount::writable_signer(target.address())];
    invoke_signed::<1, &AccountView>(&InstructionView { program_id: &SYSTEM, data: &d, accounts: &metas }, &[target], &signer)?;
    let mut d = [0u8; 36];
    d[0] = 1;
    d[4..36].copy_from_slice(owner.as_array());
    invoke_signed::<1, &AccountView>(&InstructionView { program_id: &SYSTEM, data: &d, accounts: &metas }, &[target], &signer)
}
