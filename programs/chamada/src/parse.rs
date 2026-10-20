//! Every byte rule of the program, as plain functions with no syscalls, so tests/host.rs can run them.

/// Alpenglow's genesis certificate account: the PDA of seed "carlgration" under the Alpenglow feature id
/// A1pengvuM6JEcyNuTnMqepBKhwHE3N6PmUrdATGawhJS (bump 254). Base58 42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1.
pub const CERT_ADDRESS: [u8; 32] = [
    44, 248, 141, 115, 253, 109, 50, 163, 247, 221, 68, 254, 232, 147, 120, 240, 17, 33, 81, 140, 222, 224, 78, 102, 189,
    239, 46, 255, 210, 80, 163, 158,
];
/// SysvarS1otHashes111111111111111111111111111
pub const SLOT_HASHES_ID: [u8; 32] = [
    6, 167, 213, 23, 25, 47, 10, 175, 198, 242, 101, 227, 251, 119, 204, 122, 218, 130, 197, 41, 208, 190, 59, 19, 110, 45,
    0, 85, 32, 0, 0, 0,
];
/// 11111111111111111111111111111111
pub const SYSTEM_PROGRAM: [u8; 32] = [0; 32];

pub const SEED: &[u8] = b"chamada";
pub const DISCRIMINATOR: &[u8; 8] = b"CHAMADA1";
pub const RECORD_LEN: usize = 648;
/// The record keeps at most 256 bitmap bytes (3 header bytes and up to 2,024 bits).
pub const MAX_BITMAP: usize = 256;
pub const MAX_RANKS: u16 = ((MAX_BITMAP - 3) * 8) as u16;

/// Optional build-time lock on `init` (no change to accounts or data): build with
/// CHAMADA_INIT_AUTHORITY_HEX=<64 hex chars> (build.sh sets it from CHAMADA_INIT_AUTHORITY=<base58>) and only
/// that key can create records. Unset (the devnet build): any payer can, as long as the mint signs (init
/// always needs the mint's own signature, see processor::init).
pub const INIT_AUTHORITY: Option<[u8; 32]> = match option_env!("CHAMADA_INIT_AUTHORITY_HEX") {
    Some(h) => Some(hex32(h)),
    None => None,
};

const fn hex32(s: &str) -> [u8; 32] {
    let b = s.as_bytes();
    assert!(b.len() == 64, "CHAMADA_INIT_AUTHORITY_HEX must be 64 hex characters");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (nib(b[2 * i]) << 4) | nib(b[2 * i + 1]);
        i += 1;
    }
    out
}

const fn nib(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("CHAMADA_INIT_AUTHORITY_HEX is not hex"),
    }
}

/// Record layout (byte offsets).
pub mod off {
    pub const DISCRIMINATOR: usize = 0;
    pub const MINT: usize = 8;
    pub const AUTHORITY: usize = 40;
    pub const RANK_COUNT: usize = 72;
    pub const GRID_HASH: usize = 74;
    pub const SEALED: usize = 106;
    pub const FIRST_BLOCK: usize = 107;
    pub const SEAL_SLOT: usize = 108;
    pub const PARENT_SLOT: usize = 116;
    pub const SEALER: usize = 124;
    pub const SIGNER_COUNT: usize = 156;
    pub const CERT_SLOT: usize = 158;
    pub const BLOCK_ID: usize = 166;
    pub const SIGNATURE: usize = 198;
    pub const BITMAP_LEN: usize = 390;
    pub const BITMAP: usize = 392;
    pub const END: usize = 648;
}

/// Certificate account layout: u64 LE slot | 32-byte block_id | 192-byte BLS signature | u64 LE bitmap
/// length | bitmap (version byte 0 = Base2, u16 LE bit count, raw bits Lsb0).
pub const CERT_HEADER: usize = 8 + 32 + 192 + 8;
pub const CERT_MIN_LEN: usize = CERT_HEADER + 3;

/// Custom error codes (ProgramError::Custom).
pub mod err {
    /// mapped to ProgramError::InvalidInstructionData
    pub const BAD_INSTRUCTION_DATA: u32 = u32::MAX;
    pub const ALREADY_INITIALIZED: u32 = 1;
    pub const WRONG_RECORD_ADDRESS: u32 = 2;
    pub const RANK_COUNT_TOO_LARGE: u32 = 3;
    pub const NOT_A_RECORD: u32 = 4;
    pub const ALREADY_SEALED: u32 = 5;
    pub const WRONG_CERT_ADDRESS: u32 = 6;
    pub const CERT_WRONG_OWNER: u32 = 7;
    /// The certificate account has no (or too little) data: before migration, or prefunded like mainnet today.
    pub const CERT_NOT_WRITTEN: u32 = 8;
    pub const CERT_INCONSISTENT: u32 = 9;
    pub const BITMAP_TOO_LONG: u32 = 10;
    pub const BITMAP_VERSION: u32 = 11;
    pub const RANK_COUNT_MISMATCH: u32 = 12;
    pub const WRONG_SLOT_HASHES: u32 = 13;
    pub const WRONG_SYSTEM_PROGRAM: u32 = 14;
    pub const NOT_WRITABLE: u32 = 15;
    pub const WRONG_INIT_AUTHORITY: u32 = 16;
    /// init must be signed by the mint's own key (the coin's mint keypair).
    pub const MINT_MUST_SIGN: u32 = 17;
}

#[inline(always)]
pub fn rd_u16(d: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([d[at], d[at + 1]])
}

#[inline(always)]
pub fn rd_u64(d: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[at..at + 8]);
    u64::from_le_bytes(b)
}

/// Init instruction data: [0] || rank_count u16 LE || grid_hash [32].
pub fn parse_init_data(data: &[u8]) -> Result<(u16, &[u8; 32]), u32> {
    let Some(([0, lo, hi], grid_hash)) = data.split_first_chunk::<3>() else {
        return Err(err::BAD_INSTRUCTION_DATA);
    };
    let Ok(grid_hash) = <&[u8; 32]>::try_from(grid_hash) else {
        return Err(err::BAD_INSTRUCTION_DATA);
    };
    let rank_count = u16::from_le_bytes([*lo, *hi]);
    if rank_count > MAX_RANKS {
        return Err(err::RANK_COUNT_TOO_LARGE);
    }
    Ok((rank_count, grid_hash))
}

/// A certificate that passed every check, borrowed from the account's data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cert<'a> {
    pub slot: u64,
    pub block_id: &'a [u8; 32],
    pub signature: &'a [u8; 192],
    /// the whole bitmap as stored: version byte, u16 bit count, bits
    pub bitmap: &'a [u8],
    pub bit_count: u16,
    pub signer_count: u16,
}

/// The seal's checks on the certificate account, in order: exact address, System program owner, data
/// long enough to be written (an empty or prefunded account fails here), bitmap length inside the data,
/// bitmap at most 256 bytes, version byte 0, enough bytes for the bit count, bit count == rank_count
/// (unless rank_count is 0, test mode). Popcount over the first bit_count bits only.
pub fn check_cert<'a>(address: &[u8], owner: &[u8], data: &'a [u8], rank_count: u16) -> Result<Cert<'a>, u32> {
    if address != CERT_ADDRESS {
        return Err(err::WRONG_CERT_ADDRESS);
    }
    if owner != SYSTEM_PROGRAM {
        return Err(err::CERT_WRONG_OWNER);
    }
    if data.len() < CERT_MIN_LEN {
        return Err(err::CERT_NOT_WRITTEN);
    }
    // fixed-size pieces, without panics (the early returns below cannot happen after the length check)
    let Some((slot, rest)) = data.split_first_chunk::<8>() else { return Err(err::CERT_NOT_WRITTEN) };
    let Some((block_id, rest)) = rest.split_first_chunk::<32>() else { return Err(err::CERT_NOT_WRITTEN) };
    let Some((signature, rest)) = rest.split_first_chunk::<192>() else { return Err(err::CERT_NOT_WRITTEN) };
    let Some((bitmap_len, rest)) = rest.split_first_chunk::<8>() else { return Err(err::CERT_NOT_WRITTEN) };
    let bitmap_len = u64::from_le_bytes(*bitmap_len);
    if bitmap_len < 3 || bitmap_len > rest.len() as u64 {
        return Err(err::CERT_INCONSISTENT);
    }
    if bitmap_len > MAX_BITMAP as u64 {
        return Err(err::BITMAP_TOO_LONG);
    }
    let Some(bitmap) = rest.get(..bitmap_len as usize) else { return Err(err::CERT_INCONSISTENT) };
    let Some((&[version, lo, hi], bits)) = bitmap.split_first_chunk::<3>() else { return Err(err::CERT_INCONSISTENT) };
    if version != 0 {
        return Err(err::BITMAP_VERSION);
    }
    let bit_count = u16::from_le_bytes([lo, hi]);
    if (bit_count as usize).div_ceil(8) > bits.len() {
        return Err(err::CERT_INCONSISTENT);
    }
    if rank_count != 0 && bit_count != rank_count {
        return Err(err::RANK_COUNT_MISMATCH);
    }
    Ok(Cert { slot: u64::from_le_bytes(*slot), block_id, signature, bitmap, bit_count, signer_count: popcount(bits, bit_count) })
}

/// Set bits among the first `n` bits (Lsb0: bit i is byte i/8, bit i%8).
pub fn popcount(bits: &[u8], n: u16) -> u16 {
    let n = n as usize;
    let (whole, tail) = bits.split_at_checked(n / 8).unwrap_or((bits, &[]));
    let mut c: u32 = whole.iter().map(|b| b.count_ones()).sum();
    let rest = n % 8;
    if let (true, Some(b)) = (rest != 0, tail.first()) {
        c += (b & ((1u8 << rest) - 1)).count_ones();
    }
    c as u16
}

/// Whether rank `i` signed (Lsb0).
pub fn signed(bitmap: &[u8], i: usize) -> bool {
    bitmap.get(3 + i / 8).is_some_and(|b| b >> (i % 8) & 1 == 1)
}

/// The newest SlotHashes entry's slot (the parent of the slot the transaction runs in), or None when the
/// data is empty or shorter than its count says. Layout: u64 LE count, then (u64 slot, 32-byte hash)
/// entries, newest first.
pub fn parent_slot(slot_hashes: &[u8]) -> Option<u64> {
    let (count, rest) = slot_hashes.split_first_chunk::<8>()?;
    let (newest, _hash) = rest.split_first_chunk::<8>()?;
    if u64::from_le_bytes(*count) == 0 || rest.len() < 40 {
        return None;
    }
    Some(u64::from_le_bytes(*newest))
}

/// 1 when the seal runs in the direct child of the certificate's block (the first Alpenglow block).
pub fn first_block(parent: Option<u64>, cert_slot: u64) -> u8 {
    (parent == Some(cert_slot)) as u8
}

/// The record must be Chamada's (the processor checks the owner), 648 bytes, tagged, and not yet sealed.
/// Returns its rank_count.
pub fn check_record_for_seal(record: &[u8]) -> Result<u16, u32> {
    if record.len() != RECORD_LEN || &record[..8] != DISCRIMINATOR {
        return Err(err::NOT_A_RECORD);
    }
    if record[off::SEALED] != 0 {
        return Err(err::ALREADY_SEALED);
    }
    Ok(rd_u16(record, off::RANK_COUNT))
}

/// A repeated init (the mint signed it again) may rewrite an existing record only while it is unsealed:
/// it must be Chamada's 648-byte tagged record, hold this mint (always true at the right PDA, checked
/// anyway), and not be sealed. Ok means init may rewrite rank_count, grid_hash and authority.
pub fn check_record_for_reinit(record: &[u8], mint: &[u8; 32]) -> Result<(), u32> {
    if record.len() != RECORD_LEN || &record[..8] != DISCRIMINATOR {
        return Err(err::NOT_A_RECORD);
    }
    if &record[off::MINT..off::AUTHORITY] != mint {
        return Err(err::WRONG_RECORD_ADDRESS);
    }
    if record[off::SEALED] != 0 {
        return Err(err::ALREADY_SEALED);
    }
    Ok(())
}

/// Fills a freshly created (zeroed) record, or rewrites an unsealed one's init fields (tag and mint stay
/// the same; everything from byte 106 on is still zero before a seal).
pub fn write_init(record: &mut [u8; RECORD_LEN], mint: &[u8; 32], authority: &[u8; 32], rank_count: u16, grid_hash: &[u8; 32]) {
    record[off::DISCRIMINATOR..off::MINT].copy_from_slice(DISCRIMINATOR);
    record[off::MINT..off::AUTHORITY].copy_from_slice(mint);
    record[off::AUTHORITY..off::RANK_COUNT].copy_from_slice(authority);
    record[off::RANK_COUNT..off::GRID_HASH].copy_from_slice(&rank_count.to_le_bytes());
    record[off::GRID_HASH..off::SEALED].copy_from_slice(grid_hash);
}

/// Writes the copy of the certificate and the seal's own fields; zero-pads the bitmap area.
pub fn write_seal(record: &mut [u8; RECORD_LEN], cert: &Cert, seal_slot: u64, parent_slot: u64, first_block: u8, sealer: &[u8; 32]) {
    record[off::SEALED] = 1;
    record[off::FIRST_BLOCK] = first_block;
    record[off::SEAL_SLOT..off::PARENT_SLOT].copy_from_slice(&seal_slot.to_le_bytes());
    record[off::PARENT_SLOT..off::SEALER].copy_from_slice(&parent_slot.to_le_bytes());
    record[off::SEALER..off::SIGNER_COUNT].copy_from_slice(sealer);
    record[off::SIGNER_COUNT..off::CERT_SLOT].copy_from_slice(&cert.signer_count.to_le_bytes());
    record[off::CERT_SLOT..off::BLOCK_ID].copy_from_slice(&cert.slot.to_le_bytes());
    record[off::BLOCK_ID..off::SIGNATURE].copy_from_slice(cert.block_id);
    record[off::SIGNATURE..off::BITMAP_LEN].copy_from_slice(cert.signature);
    record[off::BITMAP_LEN..off::BITMAP].copy_from_slice(&(cert.bitmap.len().min(MAX_BITMAP) as u16).to_le_bytes());
    let n = cert.bitmap.len().min(MAX_BITMAP); // check_cert already refused more than 256
    let (copy, pad) = record[off::BITMAP..].split_at_mut(n);
    copy.copy_from_slice(&cert.bitmap[..n]);
    pad.fill(0);
}

/// The seal's one log line, written into `buf`; returns its length (at most 140 bytes):
/// "chamada sealed: cert slot S, N/M signed, parent P, first block yes|no"
pub fn seal_line(buf: &mut [u8; 160], cert_slot: u64, signers: u16, bits: u16, parent: u64, first: u8) -> usize {
    let mut n = 0;
    n = put(buf, n, b"chamada sealed: cert slot ");
    n = put_u64(buf, n, cert_slot);
    n = put(buf, n, b", ");
    n = put_u64(buf, n, signers as u64);
    n = put(buf, n, b"/");
    n = put_u64(buf, n, bits as u64);
    n = put(buf, n, b" signed, parent ");
    n = put_u64(buf, n, parent);
    n = put(buf, n, if first == 1 { b", first block yes" } else { b", first block no" });
    n
}

fn put(buf: &mut [u8], at: usize, s: &[u8]) -> usize {
    match buf.get_mut(at..).and_then(|b| b.get_mut(..s.len())) {
        Some(dst) => {
            dst.copy_from_slice(s);
            at + s.len()
        }
        None => at,
    }
}

fn put_u64(buf: &mut [u8], at: usize, mut v: u64) -> usize {
    let mut tmp = [0u8; 20];
    let mut i = tmp.len();
    for slot in tmp.iter_mut().rev() {
        *slot = b'0' + (v % 10) as u8;
        v /= 10;
        i -= 1;
        if v == 0 {
            break;
        }
    }
    put(buf, at, tmp.get(i..).unwrap_or(&[]))
}
