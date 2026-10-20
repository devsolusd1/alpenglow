#!/bin/bash
# Every Chamada program test that needs no SOL. Run it from Linux or WSL:
#   wsl -e bash -lc 'bash /mnt/c/Users/John/RafinhaProject/chamada/programs/test.sh'
# 1. build.sh: the host tests (parser, first_block on crafted SlotHashes bytes, record writes, log line),
#    then the SBF build;
# 2. tests/make-fixtures.mjs: the certificate fixtures (FETCH_CERT=1 first refreshes the devnet certificate
#    with `solana account -u d 42Ym56... --output json`, read only);
# 3. solana-test-validator with the real devnet certificate at 42Ym56... and the same bytes at a second
#    address, the program in genesis at its devnet id: tests/local.mjs cert;
# 4. a fresh validator with 42Ym56... as mainnet has it today (0.1 SOL, no data): tests/local.mjs empty.
# Keys are throwaways made in memory; nothing is sent to any cluster.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
target="${CHAMADA_TARGET:-$HOME/chamada-target}"
program="$(node -e 'console.log(require("./program.json").devnet)')"
export CHAMADA_PROGRAM="$program"
CERT=42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1
COPY=US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx

bash ./build.sh
so="$target/deploy/chamada.so"

if [ "${FETCH_CERT:-0}" = 1 ]; then
  solana account -u d "$CERT" --output json > tests/fixtures/cert-devnet.live.json
  node tests/make-fixtures.mjs tests/fixtures/cert-devnet.live.json
else
  node tests/make-fixtures.mjs
fi

run_validator() { # $@: extra --account arguments
  local ledger="$target/ledger" log="$target/validator.log"
  solana-test-validator --reset --quiet --ledger "$ledger" --bpf-program "$program" "$so" "$@" > "$log" 2>&1 &
  validator=$!
  for _ in $(seq 1 60); do
    solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1 && break
    sleep 1
  done
  solana -u http://127.0.0.1:8899 cluster-version
}
stop_validator() { kill "$validator" 2>/dev/null || true; wait "$validator" 2>/dev/null || true; }
trap stop_validator EXIT

run_validator --account "$CERT" tests/fixtures/cert-devnet-account.json --account "$COPY" tests/fixtures/cert-copy-account.json
node tests/local.mjs cert
stop_validator

run_validator --account "$CERT" tests/fixtures/cert-empty-account.json
node tests/local.mjs empty
stop_validator
echo "test.sh: all passed"
