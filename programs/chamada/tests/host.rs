//! Host tests of Chamada's byte rules (no validator): the certificate parser on the real devnet
//! certificate and on crafted variants, first_block on crafted SlotHashes bytes, and the record writes.
//! Run: cargo test --release (build.sh's host step, or test.sh).

use chamada::parse::*;

/// The real devnet genesis certificate (42Ym56..., 246 bytes, slot 504,148,999, 17 ranks, 11 signers).
const DEVNET: &[u8] = include_bytes!("../../tests/fixtures/cert-devnet.bin");
const SYS: [u8; 32] = SYSTEM_PROGRAM;
const DEVNET_SIGNERS: [usize; 11] = [0, 1, 2, 3, 4, 7, 9, 10, 14, 15, 16];

fn ok(data: &[u8], rank_count: u16) -> Cert<'_> {
    check_cert(&CERT_ADDRESS, &SYS, data, rank_count).expect("certificate accepted")
}
fn bad(data: &[u8], rank_count: u16) -> u32 {
    check_cert(&CERT_ADDRESS, &SYS, data, rank_count).expect_err("certificate refused")
}

/// A certificate with `bitmap` (header included) after the devnet header.
fn with_bitmap(bitmap: &[u8]) -> Vec<u8> {
    let mut v = DEVNET[..CERT_HEADER - 8].to_vec();
    v.extend_from_slice(&(bitmap.len() as u64).to_le_bytes());
    v.extend_from_slice(bitmap);
    v
}

/// SlotHashes bytes: count, then (slot, hash) newest first.
fn slot_hashes(slots: &[u64]) -> Vec<u8> {
    let mut v = (slots.len() as u64).to_le_bytes().to_vec();
    for (i, s) in slots.iter().enumerate() {
        v.extend_from_slice(&s.to_le_bytes());
        v.extend_from_slice(&[(i % 251) as u8 + 1; 32]);
    }
    v
}

#[test]
fn devnet_certificate_parses() {
    assert_eq!(DEVNET.len(), 246);
    let c = ok(DEVNET, 17);
    assert_eq!(c.slot, 504_148_999);
    assert_eq!(c.bit_count, 17);
    assert_eq!(c.signer_count, 11);
    assert_eq!(c.block_id, &DEVNET[8..40]);
    assert_eq!(c.signature, &DEVNET[40..232]);
    assert_eq!(c.bitmap, &[0x00, 0x11, 0x00, 0x9f, 0xc6, 0x01]);
    let ranks: Vec<usize> = (0..17).filter(|&i| signed(c.bitmap, i)).collect();
    assert_eq!(ranks, DEVNET_SIGNERS);
    // test mode: rank_count 0 takes any bit count
    assert_eq!(ok(DEVNET, 0), c);
}

#[test]
fn certificate_refusals() {
    // rank_count mismatch, both ways
    assert_eq!(bad(DEVNET, 18), err::RANK_COUNT_MISMATCH);
    assert_eq!(bad(DEVNET, 16), err::RANK_COUNT_MISMATCH);
    // wrong address, wrong owner
    let mut other = CERT_ADDRESS;
    other[31] ^= 1;
    assert_eq!(check_cert(&other, &SYS, DEVNET, 17), Err(err::WRONG_CERT_ADDRESS));
    assert_eq!(check_cert(&CERT_ADDRESS, &SLOT_HASHES_ID, DEVNET, 17), Err(err::CERT_WRONG_OWNER));
    // not written yet: empty (mainnet today: 0.1 SOL, no data), or shorter than the minimum
    assert_eq!(bad(&[], 17), err::CERT_NOT_WRITTEN);
    assert_eq!(bad(&DEVNET[..CERT_MIN_LEN - 1], 0), err::CERT_NOT_WRITTEN);
    // bitmap length larger than the data, or below the 3 header bytes
    assert_eq!(bad(&DEVNET[..245], 17), err::CERT_INCONSISTENT);
    let mut short = DEVNET.to_vec();
    short[CERT_HEADER - 8..CERT_HEADER].copy_from_slice(&2u64.to_le_bytes());
    assert_eq!(bad(&short, 0), err::CERT_INCONSISTENT);
    let mut huge = DEVNET.to_vec();
    huge[CERT_HEADER - 8..CERT_HEADER].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_eq!(bad(&huge, 0), err::CERT_INCONSISTENT);
    // fewer bit bytes than the bit count needs
    assert_eq!(bad(&with_bitmap(&[0, 17, 0, 0xff, 0xff]), 17), err::CERT_INCONSISTENT);
    // version byte other than 0 (Base2)
    assert_eq!(bad(&with_bitmap(&[1, 17, 0, 0x9f, 0xc6, 0x01]), 17), err::BITMAP_VERSION);
    // more than 256 bitmap bytes
    let mut long = vec![0u8, 0xd0, 0x07];
    long.resize(257, 0);
    assert_eq!(bad(&with_bitmap(&long), 0), err::BITMAP_TOO_LONG);
}

#[test]
fn mainnet_sized_bitmap() {
    // 673 ranks: 85 bit bytes, 88-byte bitmap, a 328-byte account
    let mut bm = vec![0u8, (673 & 0xff) as u8, (673 >> 8) as u8];
    bm.extend(std::iter::repeat(0xff).take(84));
    bm.push(0x01); // rank 672
    let data = with_bitmap(&bm);
    assert_eq!(data.len(), 328);
    let c = ok(&data, 673);
    assert_eq!((c.bit_count, c.signer_count), (673, 673));
    // stray high bits past the bit count are not counted
    let mut bm2 = bm.clone();
    *bm2.last_mut().unwrap() = 0xff;
    assert_eq!(ok(&with_bitmap(&bm2), 673).signer_count, 673);
    // the largest bitmap the record holds
    let mut max = vec![0u8, (MAX_RANKS & 0xff) as u8, (MAX_RANKS >> 8) as u8];
    max.resize(MAX_BITMAP, 0x55);
    assert_eq!(ok(&with_bitmap(&max), MAX_RANKS).signer_count, MAX_RANKS / 2);
    // trailing bytes after the bitmap are tolerated (the bitmap length says where it ends)
    let mut padded = DEVNET.to_vec();
    padded.extend_from_slice(&[0xee; 4]);
    assert_eq!(ok(&padded, 17).bitmap, &[0x00, 0x11, 0x00, 0x9f, 0xc6, 0x01]);
}

#[test]
fn first_block_from_slot_hashes() {
    let cert_slot = 504_148_999;
    // in the direct child of the certificate's block, the newest entry is the certificate's slot
    let sh = slot_hashes(&[cert_slot, cert_slot - 1, cert_slot - 2]);
    assert_eq!(parent_slot(&sh), Some(cert_slot));
    assert_eq!(first_block(parent_slot(&sh), cert_slot), 1);
    // any later block: 0, and never an error
    let later = slot_hashes(&[cert_slot + 1, cert_slot]);
    assert_eq!(parent_slot(&later), Some(cert_slot + 1));
    assert_eq!(first_block(parent_slot(&later), cert_slot), 0);
    // older entries that equal the certificate's slot do not count
    let skipped = slot_hashes(&[cert_slot + 5, cert_slot]);
    assert_eq!(first_block(parent_slot(&skipped), cert_slot), 0);
    // empty or truncated SlotHashes: no parent, first_block 0
    assert_eq!(parent_slot(&slot_hashes(&[])), None);
    assert_eq!(parent_slot(&[]), None);
    assert_eq!(parent_slot(&slot_hashes(&[cert_slot])[..40]), None);
    assert_eq!(first_block(None, cert_slot), 0);
    assert_eq!(first_block(None, 0), 0);
    // a full 512-entry sysvar (20,488 bytes)
    let full: Vec<u64> = (0..512).map(|i| cert_slot - i).collect();
    let sh = slot_hashes(&full);
    assert_eq!(sh.len(), 20_488);
    assert_eq!(first_block(parent_slot(&sh), cert_slot), 1);
}

#[test]
fn init_data_and_record() {
    let mut data = vec![0u8];
    data.extend_from_slice(&17u16.to_le_bytes());
    data.extend_from_slice(&[0xab; 32]);
    let (rank_count, grid_hash) = parse_init_data(&data).unwrap();
    assert_eq!((rank_count, grid_hash), (17, &[0xab; 32]));
    assert_eq!(parse_init_data(&data[..34]), Err(err::BAD_INSTRUCTION_DATA));
    let mut too_many = data.clone();
    too_many[1..3].copy_from_slice(&(MAX_RANKS + 1).to_le_bytes());
    assert_eq!(parse_init_data(&too_many), Err(err::RANK_COUNT_TOO_LARGE));

    let mut rec = [0u8; RECORD_LEN];
    assert_eq!(check_record_for_seal(&rec), Err(err::NOT_A_RECORD));
    write_init(&mut rec, &[1; 32], &[2; 32], rank_count, grid_hash);
    assert_eq!(&rec[0..8], b"CHAMADA1");
    assert_eq!(&rec[8..40], &[1; 32]);
    assert_eq!(&rec[40..72], &[2; 32]);
    assert_eq!(rd_u16(&rec, 72), 17);
    assert_eq!(&rec[74..106], &[0xab; 32]);
    assert_eq!(check_record_for_seal(&rec), Ok(17));
    assert_eq!(check_record_for_seal(&rec[..647]), Err(err::NOT_A_RECORD));

    // garbage in the bitmap area must be cleared by the seal's zero padding
    rec[600..648].fill(0x77);
    let c = ok(DEVNET, 17);
    write_seal(&mut rec, &c, 600, 599, 0, &[3; 32]);
    assert_eq!((rec[106], rec[107]), (1, 0));
    assert_eq!(rd_u64(&rec, 108), 600);
    assert_eq!(rd_u64(&rec, 116), 599);
    assert_eq!(&rec[124..156], &[3; 32]);
    assert_eq!(rd_u16(&rec, 156), 11);
    assert_eq!(&rec[158..166], &DEVNET[0..8]);
    assert_eq!(&rec[166..198], &DEVNET[8..40]);
    assert_eq!(&rec[198..390], &DEVNET[40..232]);
    assert_eq!(rd_u16(&rec, 390), 6);
    assert_eq!(&rec[392..398], &DEVNET[240..246]);
    assert!(rec[398..648].iter().all(|&b| b == 0));
    // the record's copy rebuilds the certificate account byte for byte
    let mut rebuilt = rec[158..390].to_vec();
    rebuilt.extend_from_slice(&(rd_u16(&rec, 390) as u64).to_le_bytes());
    rebuilt.extend_from_slice(&rec[392..392 + rd_u16(&rec, 390) as usize]);
    assert_eq!(rebuilt, DEVNET);
    assert_eq!(check_record_for_seal(&rec), Err(err::ALREADY_SEALED));
}

#[test]
fn reinit_rules() {
    assert_eq!(err::MINT_MUST_SIGN, 17);
    let mint = [1u8; 32];
    // not a record: wrong size, untagged, or all zero
    assert_eq!(check_record_for_reinit(&[0u8; RECORD_LEN], &mint), Err(err::NOT_A_RECORD));
    let mut rec = [0u8; RECORD_LEN];
    write_init(&mut rec, &mint, &[2; 32], 17, &[0xab; 32]);
    assert_eq!(check_record_for_reinit(&rec[..647], &mint), Err(err::NOT_A_RECORD));
    // an unsealed record of this mint may be rewritten
    assert_eq!(check_record_for_reinit(&rec, &mint), Ok(()));
    // a record whose stored mint differs is refused
    let mut other = mint;
    other[31] ^= 1;
    assert_eq!(check_record_for_reinit(&rec, &other), Err(err::WRONG_RECORD_ADDRESS));
    // the rewrite: new rank_count, grid_hash and authority; tag and mint unchanged; the rest still zero
    write_init(&mut rec, &mint, &[9; 32], 18, &[0xcd; 32]);
    assert_eq!(&rec[0..8], b"CHAMADA1");
    assert_eq!(&rec[8..40], &mint);
    assert_eq!(&rec[40..72], &[9; 32]);
    assert_eq!(rd_u16(&rec, 72), 18);
    assert_eq!(&rec[74..106], &[0xcd; 32]);
    assert!(rec[106..].iter().all(|&b| b == 0));
    assert_eq!(check_record_for_seal(&rec), Ok(18));
    // after the seal: refused
    write_init(&mut rec, &mint, &[2; 32], 17, &[0xab; 32]);
    write_seal(&mut rec, &ok(DEVNET, 17), 600, 599, 0, &[3; 32]);
    assert_eq!(check_record_for_reinit(&rec, &mint), Err(err::ALREADY_SEALED));
    // a wrong mint is reported before the sealed flag
    assert_eq!(check_record_for_reinit(&rec, &other), Err(err::WRONG_RECORD_ADDRESS));
}

#[test]
fn log_line() {
    let mut buf = [0u8; 160];
    let n = seal_line(&mut buf, 504_148_999, 11, 17, 512_840_280, 0);
    assert_eq!(
        std::str::from_utf8(&buf[..n]).unwrap(),
        "chamada sealed: cert slot 504148999, 11/17 signed, parent 512840280, first block no"
    );
    let n = seal_line(&mut buf, u64::MAX, 2024, 2024, u64::MAX, 1);
    assert!(n <= 140);
    assert!(std::str::from_utf8(&buf[..n]).unwrap().ends_with("first block yes"));
}

#[test]
fn init_authority_unset_in_this_build() {
    // the devnet and test builds leave init open; a mainnet build may set CHAMADA_INIT_AUTHORITY
    if std::env::var("CHAMADA_INIT_AUTHORITY_HEX").is_err() {
        assert_eq!(INIT_AUTHORITY, None);
    }
}
