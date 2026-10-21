// What the page and /api/cert need to know about the coin. mint, programId and buyUrl stay null until launch;
// the page hides name, ticker, contract address and buy link while they are null.
export const CONFIG = {
  name: "AlpenSol",
  ticker: "ALPEN",      // shown with a $
  mint: null,            // the coin's mint address on mainnet
  programId: null,       // the Chamada program on mainnet (record PDA ["chamada", mint])
  network: "mainnet-beta",
  rehearsal: true,       // true: the page replays the devnet certificate (17 squares), labelled as such
  buyUrl: null,          // where "Buy" goes once the coin exists; hidden while null
  siteUrl: "https://www.alpensol.fun",         // "https://<domain>" once the domain is known, then run node site-tools/set-domain.mjs:
                         // it writes the absolute share-image addresses into index.html and metadata.json
  // Rehearsal only: a devnet program and test mint whose record the page reads for the seal panel.
  devnet: {
    programId: "HjCLtPndj5UMzZmfqtKruVDsg1bhT7az4c5g4ijc7vji",
    mint: null,
  },
};

export const { name, ticker, mint, programId, network, rehearsal, buyUrl } = CONFIG;
export default CONFIG;
