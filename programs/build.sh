#!/bin/bash
# Builds the Chamada program for SBF (and runs its host tests first). Run it from Linux or WSL:
#   wsl -e bash -lc 'bash /mnt/c/Users/John/RafinhaProject/chamada/programs/build.sh'
# Output: $CHAMADA_TARGET/deploy/chamada.so (default ~/chamada-target, native WSL disk: cargo is slow on /mnt/c).
# Optional mainnet lock on init: CHAMADA_INIT_AUTHORITY=<base58 pubkey> bash build.sh  (only that key can
# create records; unset, any payer can, which is what the devnet build and the tests use). Either way init
# also needs the mint's own signature.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
target="${CHAMADA_TARGET:-$HOME/chamada-target}"
offline="${CARGO_OFFLINE:---offline}"
if [ -n "${CHAMADA_INIT_AUTHORITY:-}" ]; then
  CHAMADA_INIT_AUTHORITY_HEX="$(python3 - "$CHAMADA_INIT_AUTHORITY" <<'PY'
import sys
a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
s = sys.argv[1]; n = 0
for c in s: n = n * 58 + a.index(c)
b = n.to_bytes(32, "big")
assert len(s) >= 32, "not a base58 pubkey"
print(b.hex())
PY
)"
  export CHAMADA_INIT_AUTHORITY_HEX
  echo "init locked to $CHAMADA_INIT_AUTHORITY"
  out="$target/deploy-locked"
else
  unset CHAMADA_INIT_AUTHORITY_HEX
  out="$target/deploy"
fi
if [ "${SKIP_HOST_TESTS:-0}" != 1 ]; then
  (cd chamada && CARGO_TARGET_DIR="$target/host" cargo test --release $offline -- --nocapture)
fi
(cd chamada && CARGO_TARGET_DIR="$target/sbf" cargo build-sbf $offline --sbf-out-dir "$out")
so="$out/chamada.so"
echo "binary: $(stat -c %s "$so") bytes, sha256 $(sha256sum "$so" | cut -c1-64), at $so"
