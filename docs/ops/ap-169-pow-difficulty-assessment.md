# AP-169: Ephemeral Proof-of-Work Difficulty Assessment

Spike output for [AP-169](https://linear.app/zaks-io/issue/AP-169). Assesses whether
the ephemeral proof-of-work (PoW) difficulty is the effective anti-abuse lever it is
assumed to be, measures the real anonymous-write cost curve, and recommends a change.

## TL;DR

- **PoW at difficulty 20 is not a meaningful brake on a determined attacker.** A single
  consumer GPU solves a d20 challenge in ~0.2 ms; one commodity 8-core CPU does it in
  ~0.14 s. PoW-only (rate limits aside) that is millions of new workspaces/hour.
- **The asymmetry runs backwards.** The honest agent path (`await crypto.subtle.digest`
  per hash, which is what JS/Workers clients actually do) measures **~84k H/s → ~12 s mean
  solve at d20**, with a heavy tail. The attacker using native or GPU hashing is _cheaper
  per solve than the honest client._ The ADR's "few hundred ms honest solve" only holds if
  the honest client also uses native batched hashing, which the JS reference path does not.
- **The real ceiling is the rate-limit binding, not PoW** — as the ticket hypothesized.
  But the "global 17/min" cap is a Cloudflare native binding, which is **per-PoP and
  eventually consistent** (ADR 0064). Worst-case PoP fan-out is **~6.7M writes/hr**, not the
  ~20k/hr a single-region reading of "17/min × 20" suggests.
- **Difficulty is hardcoded** (`packages/tokens/src/pow.ts:4`), so it is _not_
  operator-tunable without a redeploy — contrary to ADR 0056's "operator-tunable caps"
  intent. The rate-limit values _are_ edit-and-redeploy tunable but still not runtime-tunable.

## What was measured

Method: replicated the exact production algorithm from `packages/tokens/src/pow.ts`
(SHA-256 over `nonce:counter`, difficulty = leading **zero bits**) and brute-forced real
challenges. Mean attempts per solve tracked 2^difficulty as expected (geometric
distribution). Hardware: one developer laptop, Node 24 / webcrypto + OpenSSL. Numbers are
order-of-magnitude, not a controlled benchmark, but the gaps here are orders of magnitude.

| Path                                                          | Hash rate (1 core) | Notes                                                                   |
| ------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| Honest JS agent (`await crypto.subtle.digest` per hash)       | **~84k H/s**       | The reference/headless-agent path. Per-call promise overhead dominates. |
| Attacker (sync native OpenSSL via `node:crypto`)              | **~915k H/s**      | ~11× faster than the honest path on the _same_ CPU.                     |
| Attacker (one mid-range consumer GPU, public hashcat figures) | **~5 GH/s**        | ~60,000× the honest path.                                               |

### Mean solve time per challenge (2^difficulty ÷ hash rate)

| Difficulty       | Honest webcrypto | Attacker 1 core | Attacker 8 cores | One consumer GPU |
| ---------------- | ---------------- | --------------- | ---------------- | ---------------- |
| **20 (current)** | ~12.4 s          | ~1.15 s         | ~0.14 s          | ~0.2 ms          |
| 22               | ~49.8 s          | ~4.58 s         | ~0.57 s          | ~0.84 ms         |
| 24               | ~199 s           | ~18.3 s         | ~2.29 s          | ~3.36 ms         |
| 26               | ~796 s           | ~73.3 s         | ~9.17 s          | ~13.4 ms         |

These are means. Solve time is geometrically distributed, so the tail is heavy: in the d20
sample the native-path **max was ~5.7 s against a ~0.87 s mean**. The honest webcrypto tail
at d20 stretches to tens of seconds. Raising difficulty to "make the honest path safe"
makes the honest tail unacceptable long before it meaningfully taxes a GPU attacker.

## Effective anonymous write ceiling at d20

Two independent ceilings stack. Writes per workspace = 20 (`DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL`).

**PoW-only (if rate limits were absent):**

| Attacker       | New workspaces/hr | Anonymous writes/hr (×20) |
| -------------- | ----------------- | ------------------------- |
| 1 CPU core     | ~3,100            | ~63k                      |
| 8 CPU cores    | ~25k              | ~500k                     |
| 1 consumer GPU | ~17M              | ~343M                     |

PoW alone does essentially nothing against a GPU. It is a speed bump for a script kiddie on
one core, invisible to anyone who reaches for `hashcat`.

**With the rate-limit bindings (the actual ceiling):**

- Per-IP cap **10/min** → 600 ws/hr/IP → **12k writes/hr per IP**, then the attacker needs
  fresh IPs (cheap at scale via residential/proxy pools).
- "Global" cap **17/min** is a native binding = **per-PoP, eventually consistent** (ADR
  0064 explicitly accepts "brief overshoot at PoP fan-out"). Worst case across ~330
  Cloudflare PoPs: `17/min × 60 × 330 × 20` ≈ **6.7M writes/hr**. Single-region best case:
  ~20k writes/hr. The true number sits between, driven by how widely the attacker's traffic
  fans out — which they control by choosing source geography.

**Conclusion on the ceiling:** the rate-limit bindings, not PoW, are doing the bounding, and
even they do not provide a hard global number. The 20/day per-workspace counter (verified
live, AP-170) only ever bounds one tenant; it is irrelevant to aggregate abuse.

## Recommendation

**Do not raise the PoW difficulty.** It cannot close the attacker gap (a GPU laughs at d26)
and raising it punishes the honest JS agent — the hero user — first and worst. PoW at d20 is
fine as a trivial bot speed bump and a cost signal; treat it as such, not as the lever.

Put the anti-abuse weight where it actually binds, in priority order:

1. **Make the _global_ ephemeral-provision ceiling strongly consistent.** ADR 0075 already
   anticipated this ("a Durable Object counter for the few caps that need a strongly
   consistent global ceiling, since the binding is per-PoP and eventually consistent"). The
   ephemeral-provision global cap is exactly that case: it is an abuse ceiling we want to be
   a real number, it fires at most ~17/min so the DO is not on a hot path, and it is the one
   counter where PoP overshoot turns "17/min" into "millions/hr." Move the global cap to a
   single-shard DO; keep the per-IP cap on the native binding (fail-open is fine there).
2. **Lean on the layers that already scale with the threat, not with hash rate:** short
   ephemeral Auto Deletion (1 day), script-disabled execution policy for ephemeral content
   (the actual containment), `noindex`/`nofollow`, rate limits, advisory Llama
   Guard/URL Scanner signals, and Platform Lockdown. These are what make a
   successful flood low-value; PoW never was.
3. **Make the limits operator-tunable for real.** Today difficulty is hardcoded
   (`pow.ts:4`) and the rate-limit values live in `wrangler.jsonc` (edit + redeploy). ADR
   0056 frames these as operator-tunable caps. If we want to respond to an active flood
   without shipping code, the global cap (and ideally difficulty) should read from runtime
   config (env/KV) rather than a constant. This is a precondition for "turn the dial during
   an incident."

**If we keep PoW exactly as-is** (a defensible choice), then update ADR 0075's "few hundred
ms honest solve" line — it is only true for native hashing, not the JS reference path — and
explicitly document that PoW is a minor speed bump, with the global DO counter named as the
load-bearing control.

## Suggested follow-up tickets

- **Strongly-consistent global ephemeral-provision counter (DO).** Implements
  recommendation 1. This is the concrete code change AP-169 anticipated. Target: replace the
  `EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT` native binding with a single-shard Durable Object
  enforcing a real global N/min, leaving the per-IP native binding in place.
- **Runtime-tunable ephemeral caps.** Read the global provision cap (and optionally PoW
  difficulty) from env/KV so an operator can tighten it during an incident without a deploy.
- **Doc fix (cheap):** correct the "few hundred ms honest solve" claim in ADR 0075 and note
  the per-PoP nature of the global cap inline where the 17/min number appears.

## Industry best practices on PoW algorithms (research)

Surveyed current (2025–2026) anti-abuse PoW practice to check whether a _better algorithm_
(memory-hard, asymmetric-verify) would change the conclusion. It does not, and the reason is
specific to our agent-first constraint.

**The asymmetry we measured is the known, fatal flaw of pure hash PoW.** The mCaptcha-class
critique states it plainly: server/GPU hardware is vastly more powerful than the honest
user's device, so any difficulty low enough not to drain a real user's battery still lets a
malicious server pass it tens of thousands of times an hour. That is exactly our number
(GPU ≈ 0.2 ms/solve at d20). This is not a tuning problem; it is structural for SHA-256
hashcash.

**Memory-hard functions (Argon2id, Equihash) are the standard GPU/ASIC-resistance answer —
but they don't fit a cheap-verify Worker gate, and they don't fix our threat.**

- Argon2id is the OWASP-recommended memory-hard function and resists GPU cracking by forcing
  large RAM use. But RFC 9106 gives essentially no asymmetric-verify story: Argon2 is
  expensive to _verify_ too (password-hashing shape), which is the opposite of what a PoW
  gate wants (cheap server verify). A Worker verifying Argon2 on every provision attempt
  pays real CPU/memory per call — it moves cost onto _us_, including during a flood.
- Equihash is the cleaner PoW shape (memory-hard to generate, instant to verify), but it is
  heavyweight to implement correctly and ship as WASM, and it is overkill here.
- Crucially, **memory-hardness narrows the GPU/ASIC gap, not the
  attacker-server-vs-honest-agent gap.** Our attacker is not buying ASICs; they are renting
  commodity CPUs/RAM, which is exactly what memory-hard functions assume the _honest_ user
  has. A headless attacker has as much RAM as a headless honest agent. Swapping SHA-256 for
  Argon2 raises the honest agent's cost in lockstep with the attacker's and still loses to
  scale-out. Net: more complexity, same losing asymmetry.

**Nobody serious runs PoW standalone — they layer it with risk/behavioral signals.** Cap and
Friendly Captcha both explicitly reject pure PoW: PoW is one layer, browser instrumentation /
behavioral risk scoring is the other, "defeating one layer doesn't defeat the other." PoW is
treated as a _cost signal_, never the gate.

**The catch that decides it for us:** that industry answer (layer PoW with browser/behavioral
signals or Turnstile) is _deliberately unavailable on our agent path._ ADR 0075 rejects
Turnstile and bot-score on the agent write precisely because the hero user is a headless
agent that cannot solve a browser challenge. So we cannot adopt the one thing that makes PoW
work elsewhere. That makes the **strongly-consistent global cap + the containment layers**
(short Auto Deletion, script-disabled execution policy, advisory scanner signals,
and lockdown) the _only_ place real defense can live on this path. That
reinforces recommendation 1 and argues _against_ investing in a fancier PoW
algorithm.

**Bottom line on the algorithm question:** keep SHA-256 hashcash as the cheap bot speed bump;
do **not** migrate to Argon2/Equihash. A better hash does not fix an asymmetry that is about
identity/provisioning cost, not hash hardness. Spend the effort on the global DO counter and
the containment layers instead.

## References

- `packages/tokens/src/pow.ts` — algorithm, `DEFAULT_POW_DIFFICULTY_BITS = 20` (line 4).
- `apps/api/src/routes/ephemeral.ts` — provision route, challenge issue/verify wiring.
- `packages/worker-runtime/src/rate-limit.ts` — `applyEphemeralProvisionRateLimit` (global
  fail-closed, per-IP fail-open).
- `apps/api/wrangler.jsonc` — `EPHEMERAL_PROVISION_IP_RATE_LIMIT` (10/60s),
  `EPHEMERAL_PROVISION_GLOBAL_RATE_LIMIT` (17/60s), all three envs.
- ADR 0064 — native rate-limit bindings are eventually consistent / per-PoP by design.
- ADR 0075 — agent-first ephemeral publish; names the DO-for-global-ceiling escape hatch.
- ADR 0056 — usage-policy defaults framed as operator-tunable caps.
- `packages/config/src/index.ts` — `DAILY_NEW_ARTIFACT_ALLOWANCE_EPHEMERAL = 20`.
