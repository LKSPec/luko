/* LUKO — single source of truth for configuration.
 *
 * ESM module. Consumed BOTH by the browser (client scripts load it as
 * <script type="module"> and import CONFIG) and by the Cloudflare Pages
 * Functions (functions/api/*.js import it via ../../website/config.js).
 * There is no build step, so this file is the one place these values live.
 *
 * Everything here is public on-chain data or a public endpoint. No secrets:
 * RPC keys (RPC_URL / DRPC_API_KEY), the KV binding (CARDS) and mail keys
 * (MAILJET_*) stay as Cloudflare environment bindings, never in this file.
 *
 * Changing a value here — including the donation recipient — is a deliberate,
 * versioned commit with history, not a dashboard edit. */

export const CONFIG = {
  addresses: {
    luko:          "0x4a9DA2831A691E7C4aca594CaFd58c35e0131fD1",
    usdc:          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    pool:          "0x2222A01b83Db8c533B062AEb6DE4F61D6Ae792F2",
    /* Sablier Lockup — kept for reference; no runtime use after the vesting
       counter went RPC-free (it computes purely from streams.* below). */
    sablierLockup: "0xc19a09A66887017F603E5dF420ed3Cb9a5c07C0A",
    /* Donation recipient. Dedicated wallet, holds nothing else, so every
       inbound LUKO transfer is unambiguously a donation. */
    donation:      "0x7D9766F447a6B86Cf589A31db5b5535e379863E7"
  },

  network: {
    chainId: "0x2105",              /* 8453 — Base */
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    clientRpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    /* LUKO contract creation block (found via eth_getCode binary search) */
    deployBlock: 49364826
  },

  /* Server-side RPC pool (Functions only). Every public Base RPC rate-limits
     Cloudflare's shared egress IPs, so requests spread across all of these,
     entered at a random index. Keyed endpoints from env are appended at
     runtime by the Functions and are not listed here. */
  rpc: {
    endpoints: [
      "https://mainnet.base.org",
      "https://base.drpc.org",
      "https://base.meowrpc.com",
      "https://base.gateway.tenderly.co",
      "https://base-mainnet.public.blastapi.io",
      "https://1rpc.io/base"
    ]
  },

  token: {
    symbol: "LUKO",
    decimals: 18,
    image: "https://meetluko.eu/assets/token-logo-512.png"
  },

  /* Genesis founder streams (Sablier Lockup, linear). The client counter
     computes vested amount purely from start/end/total — no runtime RPC —
     so these MUST match the on-chain stream exactly. */
  streams: {
    delta: {
      id:    902,
      start: 1785697200,   /* Aug 2 2026, 22:00 Europe/Vilnius (19:00 UTC) */
      end:   1819055100,   /* Aug 24 2027, 00:05 Europe/Vilnius */
      total: 140000,
      sablierUrl: "https://app.sablier.com/vesting/stream/LK3-8453-902"
    },
    /* Λ — filled by a commit once the stream is live (after 16 Aug 2026). */
    lambda: null
  }
};
