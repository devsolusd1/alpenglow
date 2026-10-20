#!/bin/bash
# Devnet run of the Chamada program (throwaway keys in ~/chamada-keys, never in the repo). Run it from WSL:
#   wsl -e bash -lc 'bash /mnt/c/Users/John/RafinhaProject/chamada/programs/devnet.sh'
# 1. keys: ~/chamada-keys/devnet-payer.json and program-devnet.json (made if missing; secrets never printed);
#    every solana/spl-token call uses its own CLI config ~/chamada-keys/cli-devnet.yml (never the default keypair);
# 2. airdrop 1 SOL when the payer holds less than 0.3 (exit 2 if the faucet refuses: then send 0.3 devnet SOL
#    to the payer address it prints and rerun);
# 3. build, then deploy (or upgrade, when the deployed bytes differ) at the id in program.json; prints the cost;
# 4. a fresh SPL test mint (its keypair kept in ~/chamada-keys/devnet-test-mint.json, since init needs the mint's
#    signature), then tests/devnet.mjs: init with rank_count 18 (wrong on purpose), a second init that corrects it
#    to 17, seal against the real devnet certificate, read back; the refusals are simulated only. Numbers go to
#    tests/devnet-result.json.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
target="${CHAMADA_TARGET:-$HOME/chamada-target}"
keys="${CHAMADA_KEYS:-$HOME/chamada-keys}"
mkdir -p "$keys" && chmod 700 "$keys"
payer="$keys/devnet-payer.json"; progkey="$keys/program-devnet.json"; cfg="$keys/cli-devnet.yml"
for k in "$payer" "$progkey"; do
  [ -s "$k" ] || solana-keygen new --no-bip39-passphrase --silent -o "$k" >/dev/null
  chmod 600 "$k"
done
solana config set -C "$cfg" --url https://api.devnet.solana.com --keypair "$payer" --commitment confirmed >/dev/null
P="$(solana-keygen pubkey "$payer")"; PROG="$(solana-keygen pubkey "$progkey")"
want="$(node -e 'console.log(require("./program.json").devnet)')"
[ "$PROG" = "$want" ] || { echo "program.json says $want but $progkey is $PROG"; exit 1; }
echo "payer $P, program $PROG"

bal() { solana balance -C "$cfg" "$P" --lamports | cut -d' ' -f1; }
if [ "$(bal)" -lt 300000000 ]; then
  solana airdrop -C "$cfg" 1 "$P" || { echo "faucet refused: send 0.3 devnet SOL to $P and rerun"; exit 2; }
fi
echo "payer balance $(bal) lamports"

SKIP_HOST_TESTS=1 bash ./build.sh
so="$target/deploy/chamada.so"
deployed="$target/devnet-deployed.so"
if solana program dump -C "$cfg" "$PROG" "$deployed" >/dev/null 2>&1 && cmp -s <(head -c "$(stat -c %s "$so")" "$deployed") "$so"; then
  echo "devnet already runs this build"
else
  before="$(bal)"
  solana program deploy -C "$cfg" --program-id "$progkey" --upgrade-authority "$payer" "$so"
  after="$(bal)"
  echo "deploy cost $((before - after)) lamports (programdata and program account rent plus fees)"
fi
solana program show -C "$cfg" "$PROG"

# init needs the mint's own signature, so the test mint's keypair is kept (a throwaway, replaced each run)
mintkey="$keys/devnet-test-mint.json"
solana-keygen new --no-bip39-passphrase --silent --force -o "$mintkey" >/dev/null
chmod 600 "$mintkey"
mint="$(spl-token create-token -C "$cfg" --fee-payer "$payer" --mint-authority "$P" --output json "$mintkey" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).commandOutput.address))')"
[ "$mint" = "$(solana-keygen pubkey "$mintkey")" ] || { echo "the test mint $mint is not $mintkey's key"; exit 1; }
echo "test mint $mint"
node tests/devnet.mjs "$mintkey"
