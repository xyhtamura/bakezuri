# Bakezuri — Working Notes

化け摺り · a Sgueltch instrument · single-file `bakezuri.html`, no build step, runs in-browser.
These are private resume-notes for Xyh and for any LLM picking this back up. They record **the
concept, what's built, why it's built that way, and where it goes next.** Read §1 for the spine,
§9–10 if you're about to edit code.

---

## 1. The concept (the spine — don't lose this)

Bakezuri is the **quantization counter-poetics** argument made into an instrument. The claim:
technical standards (type grids, Unicode, 12-TET, JPEG, MIDI, the halftone screen) **quantize** —
they carve a continuous space into a fixed standardized lattice and propagate it by inertia. The
practice works the **interstitial**: not "organic vs digital" but *continuous/emergent* vs
*snapped-to-a-standard*.

Bakezuri stages this with **two Japans** that are really one membrane:

- **Riso** — 1980s office duplicator. Standardized reproduction, the screen, the institution. The
  *quantizing* pole. (Public UI label: **装 / suit**.)
- **Suminagashi** — Heian-era ink-on-water, shrine lineages, surface-tension flow,
  **non-reproducible** (you can't pull the same print twice). The *dequantizing* pole. (Public UI
  label: **浸 / soak**.)

The private framing (keep out of UI copy): **"a yokai pretending to be a salaryman."** Public
tagline: **百万円 dips of a brush** (`百万円の筆ひと浸し`). The image to hold: *tsukumogami who came
alive at night, took a thousand brushes, and tried to simulate their own riso knowing only older
techniques* — that's why the screen jitters; it's a thousand hand-presses approximating a machine.

**The one-render thesis:** *separation quantizes, the bleed refuses.* An image is cut into a fixed
ink set on a screen (palette + grid = quantization), deposited wet, and the bleed dissolves the grid
back toward continuous matter. **Sequence is material:** later passes land on what earlier passes and
bleeds left behind; an ink mixes with what came *before* it, never after.

**Architectural consequence of the concept:** there is **one engine** — a shared wet ink-field.
Riso is not a separate code path; it's that engine **holding still** (wetness low, fix high, screen
on), a pinned region of the parameter space reached by the **disguise slider**. The slide between
浸 and 装 — and the half-dissolved states in between — is the content.

---

## 2. The engine (how it actually works)

**CPU float-field simulation, not WebGL.** Deliberate: the shared wet field with real diffusion is
the heart, and a CPU `Float32Array` field is reason-about-able and node-testable where an untested
WebGL fluid sim would risk a black screen. (WebGL is on the roadmap for performance, §8.)

- **Field:** up to `NUM_INKS` inks (default 4, dynamic 1–8 via add/remove). Each ink = one conserved
  `Float32Array(W*H)` of *load* per cell. Ping-pong `loadA`/`loadB`. Plus `fixField` (0..1 set
  amount), `grainField` (static permeability noise), `waterSum`/`repelDelta` (repulsion scratch).
- **Per frame (only while *playing*):** `step()` runs diffusion (bleed) + grain feathering + water
  repulsion + fixing; then `computeField()` resolves to the canvas. When *not* playing the bath is
  **static** and only re-resolves on demand (deposit / step / slider change). This is the default —
  bleed is deliberate, not ambient.
- **Conserved deposition:** a mark spreads a fixed budget over a soft disk, so dot-gain / the density
  halo fall out of conservation rather than being drawn.
- **Resolve (subtractive):** `result = bg × Π Cᵢ^Lᵢ` (Beer–Lambert). **Background is a separate
  compositing layer** (render-only; see §4). Ink-only export = same math over `STOCK` with
  `alpha = coverage`.
- **Ink types:** `flat` (fixed subtractive hue) · `shift` (hue rotates with load) · `duo`
  (interpolates colour→colour2 with load — thin and thick are different inks) · `glow` (emissive,
  adds light) · `iridescent` (thin-film interference colour computed from load + its local gradient =
  film-thickness slope) · `water` (clear, no colour/coverage — **repels** set inks).
- **Water repulsion:** pigment-less water pushes other inks down the water gradient (upwind
  advection, mass-conserving). Water diffuses into a hill, so the void it carves drifts and breathes.
- **Halftone screen:** jittered AM dots, per-ink rotation (riso misregistration). Strengthens toward
  装 via the disguise slider. Exists as a **display overlay** AND, for image separation, as
  **physical dots** deposited into the field (so the grid's trace dissolves in the matter, visible
  even at full 浸).
- **Dot jitter (`P.dotJitter`):** per-cell hash (`cellHash`) → position scatter + size variance.
  Applies to physical dots (separation, water-screen) and the display screen. Tuned so the dot
  *count* holds while positions/sizes unsettle — the grid stays legible, the machine reads as
  hand-approximated. This is the tsukumogami signature.

---

## 3. The process chain (sequence-as-material)

- Pending is a single nullable `{type:'ink', deposits:[…]}` — never two parallel things. Bleeds are never pending; they're eager (a chunk commits immediately, play commits one node on stop).
- Category-switch (ink↔bleed) auto-commits pending rather than discarding it — revert is cheap, a lost pending is forever.
- **Undo** (fine-grained, at head): peels the last deposit by re-derivation (restore pass base, replay survivors), or pops the last node with nothing pending.
- **Revert** (deliberate, while previewing): truncates the chain to the previewed node. Same button, relabeled by context.
- **Preview** (clicking a historical chip): non-destructive — stashes the live head (incl. pending), shows the old snapshot, leaves chain and pending untouched. Selecting the head chip again restores the stash. Acting while previewing snaps back to head first, then acts.
- Separation is now a replayable deposit (`{tool:'separate', sep, pitch}`) inside an ink pass, not a separate flag — this is what makes it composable with hand-marks in principle, though they still occupy the same single-category pending slot.
- `MAX_SNAPS` is 64, parameterized, with the memory formula noted in the reducer header.


---

## 4. The file formats (the ontology — this is doctrine)

There are now **four linked objects** in the Bakezuri ecology. Keep them distinct:

* **`.bakezuri` (recipe, v2):** the ordered chain of passes + bleeds. **Seedless**: the format structurally cannot store an RNG seed, so performing it re-bleeds stochastically → a *sibling*, not a copy. Separation passes are flagged and skipped on replay because they need the source image. This is the process score. `.bakezuri` saves **committed nodes only**; pending is never flushed on save. `.png` and `.urumizuri` capture the live field including any pending deposit. This divergence is intentional — "wet but unwritten" — and worth keeping as its own callout since it's the kind of thing a future you will rediscover and wonder if it's a bug.

* **`.urumizuri` / `URMZ` (wet field goopCodec, v1):** the actual wet-state matrix, stored as a native binary file. Header: `URMZ`, width, height, ink count, version/reserved bytes. Body: uncompressed spatial cell records, each cell storing `fixField` plus one byte per active ink-load channel. This is no longer just a preservation format; it is a **vulnerable wet body**. It can be reopened in Bakezuri, or opened in the `urumizuri.html` terminal and damaged through byte edits, hex/text mutation, replacement, truncation, drift, flare, decay, and corruption. It is a goopCodec because it is decodable, editable as data, and performable again after mutation.

* **`.png` (the pull):** stamped via the **hanko**. Two surfaces from the same data — *on background* composited, or *ink only* transparent, alpha = coverage. This is the fixed print-result, not the wet body.

* **Settings / palette state (not yet fully formalized):** ink definitions, params, and viewing conditions. Current `.bakezuri` preserves process/settings more fully; current native `.urumizuri` primarily preserves the wet matrix. Decide later whether `URMZ v2` should embed ink definitions/params, attach a trailing manifest, or stay deliberately vulnerable and palette-dependent.

**Background is render-only** — never written into `.urumizuri` or `.bakezuri`. The conceptual distinction is now: `.bakezuri` = process score, `.urumizuri` = wet matrix / goopCodec body, `.png` = pull, settings = tuning layer. Stacking prints remains the natural extension that transparent export already sets up.


---

## 5. The aesthetic (machine panel — current)

**The community copier at midnight.** Lampblack/sumi bath recessed like a tray, lit from above by one
**fluorescent tube** with a faint konbini green-white spill and irregular flicker; midnight-dark
surround. The console is a **control deck** of beveled, recessed device modules with tactile buttons
and an **LCD** process strip. The pull is a contaminated-vermilion **hanko** stamp (摺) that presses
in. **Tategaki 化け摺り** runs down the bath's left edge (Heian seam). The disguise slider travels
浸 (bath) ↔ 装 (machine).

- Palette implemented by **remapping existing CSS var *values*** (names kept) so inline styles inherit
  the new skin; a machine-panel block is appended that overrides bath/organ/chain/buttons and adds
  tube/tate/hanko. No pure white / no pure black.
- Fonts (declared, drop-in, Google fallbacks): `Bakezuri-Display` → Shippori Mincho (mincho / 浸
  register) · `Bakezuri-UI` → Zen Kaku Gothic New (clean / 装) · `Bakezuri-Mono` → Space Mono
  (the duplicator's data).
- Follows Xyh's design rules: no zero-chroma, near-symmetry over exact, irregular radii, *ma*,
  anti-lattice **except** the screen — which is the legible antagonist, on purpose.

---

## 6. Bilingual

`I18N` dictionary `{en, ja}` + `lang` state + `data-i18n` attributes + `setLang()`, toggled by
**日本語 / EN**. Coverage = primary surface (headers, poles, controls, notes, save lines, tagline).
**Gotcha handled:** `setLang` uses `innerHTML`, so file-input labels wrap their text in `<span>` to
avoid deleting the hidden `<input>`. **Known gaps:** `disguiseRead` strings and a few dynamic status
lines are still English — trivial dictionary adds.

---

## 7. Changes in the latest session (by Xyh)

- **Native `.urumizuri` / `URMZ` export:** `saveUrumi` now writes a binary wet-field file instead of the older base64/state-object model. It uses a protected 16-byte header — magic `URMZ`, width, height, ink count, version/reserved — followed by an uncompressed byte body.

- **Wet matrix body:** each spatial cell serializes as `1 + NUM_INKS` bytes: one byte for `fixField`, then one byte per active ink-load channel. Float loads are quantized against `maxLoadScale = 12.0`, making the field compact, addressable, and deliberately damageable.

- **Tolerant `.urumizuri` decoder:** Bakezuri can reopen native `URMZ` files, restore canvas dimensions and ink-channel count, then read the vulnerable body with truncation tolerance. Corrupted or shortened files fail into partial/dry-field behavior rather than hard collapse where possible.

- **`urumizuri.html` terminal:** new companion workstation for `.urumizuri` as a wet-state goopCodec. It does not accept normal images; it ingests native `.urumizuri` matrices and exposes the fluid data as a manipulable byte field.

- **Parametric damage layer:** `wet drift`, `channel flare`, `fix decay`, and `corruption` mutate the matrix before decode. These are not image filters; they operate on the wet-state data structure itself.

- **Direct data intervention:** edit mode bakes the current parametric damage into a buffer, then unlocks text/hex editing, ASCII/hex views, and find/replace. Length-changing replacement is conceptually important: it shifts downstream cell alignment and makes the wet field shear, fault, or desynchronize.

- **Export loop:** damaged/edited `.urumizuri` files can be downloaded and reopened in Bakezuri. The loop is now: Bakezuri wet field → `.urumizuri` goopCodec → byte/text/hex damage → reopened wet field → new pull or further process.


---

## 8. Roadmap (ordered — this is the plan of record)

**Harden riso first, then modularize, then fork.** Don't fork the engine; fork the *frontend* over a
shared, frozen core.

**Near-term (small, self-contained):**
1. **Repulsive *coloured* inks** (territorial / immiscible). Generalize water's repulsion field to any
   ink flagged `repels`; exclude an ink from repelling *itself* (stays cohesive); keep rendering its
   pigment. Drops that jostle and carve but won't blend — true marbling immiscibility. ~afternoon.
2. **Channel routing for separation.** Per-ink choice of what it renders from: brightness / R / G / B
   / **saturation** (vs the current auto-NNLS). "Which ink appears as what." Pairs with #1 (both
   per-ink properties). Moderate.

**Mid-term:**
3. **Harden the riso/separation core** (robustness pass before extraction).
4. **Modularize → `bakezuri-core.js`.** Extract field sim + ink types + deposition + resolve + chain
   into one module; image drag-drop + fit-to-screen + other utilities into small `script src` files.
   **Freeze them.** Both Bakezuri and the future drawing tool `script src` the same core.
5. **Settings-only load door.** Pull inks + params from any `.bakezuri`/`.urumizuri` and apply to a
   fresh bath, ignoring field/chain. Makes "extract a tuning from any file" real; clarifies the
   recipe / wet-matter / settings trio.

**Later:**
6. **Fork the suminagashi drawing tool.** *Same engine, different frontend* — separation removed,
   direct placement foregrounded; can start from a blank page. A "drawing layer between layers" is
   just a `pass` node where marks are placed by hand (the engine already does this). **Fork at the
   frontend, not the engine; the merge is automatic if the core is shared.**
7. **Stacking prints.** Composite multiple pulls, each with its own alpha (builds on transparent PNG
   export).
8. **WebGL port.** The per-frame field (diffusion + resolve + repulsion) is the hot loop and a
   textbook ping-pong FBO; separation NNLS can stay CPU or move to a shader. Makes heavy
   chains-with-snapshots and video real-time.

**Open / to explore:**
- **New process-node types** beyond pass/bleed — a **comb/rake** gesture is the obvious suminagashi
  one (drag a stylus across the floating field). See §11 for the blobSketch/Jaffer study — the
  displacement-map route may be the shortest path to both drop rings and the comb.
- **URMZ v2 / ink-definition question:** .urumizuriis now decisively the wet-field goopCodec: a vulnerable matrix that can be decoded, damaged, and reopened. The remaining question is whether futureURMZ v2should also store ink definitions + params, or whether those should remain a separate settings/tuning object. CurrentURMZ v1` should be documented as matrix-first: width, height, ink count, fix field, and load channels.
- **Determinism slider at the chain level** — save recipe alone (re-performs, 浸) vs recipe + snapshots
  (pinned reproducible edition, 装). The one-bit choice, scaled up.
- **Per-pass mixing.** Currently `mixing` is global, captured into each node's `settings` but applied
  globally at resolve. True per-pass mixing wants **per-ink blend** (each ink subtractive/additive),
  since the same ink could be used differently across passes.

---

## 9. Architecture invariants & gotchas (read before editing)

- **CPU field; can't WebGL-test in node — but the pure math IS node-testable.** Conservation,
  subtractive resolve, NNLS separation, water repulsion, dot-jitter distribution, and the whole chain
  state machine have all been validated this way. Keep doing that before shipping.
- **`loadA[k]` arrays are reassigned during ping-pong.** Snapshots copy *values* (`Float32Array.from`),
  not references. Restore guards length mismatch (ink count can change mid-session).
- **Water, separation, and repulsion all mutate the shared field — order matters.** `step()` order is
  diffuse → repel → fix.
- **Two screens coexist:** the display-overlay screen (in `computeField`) and the physically-deposited
  dots (separation / water-screen). Don't double-count or assume one is the other.
- **Background must never enter `.urumizuri` / `.bakezuri`.** It's a viewing layer.
- **Separation passes can't replay** from a recipe (no image stored) — they're flagged and skipped in
  `replayChain`; that's why `.urumizuri` exists.
- **MediaRecorder video** is Chromium-solid, Safari-flaky; it degrades to a message pointing at the
  step buttons.
- **`setLang` rewrites `innerHTML`** — never tag an element that contains real children (e.g. file
  inputs) with `data-i18n`; wrap the text in a span.
- **Custom fonts are optional** — drop `Bakezuri-Display/UI/Mono.woff2` into the same dir or it runs on
  the Google fallbacks.
- .urumizuri is now a vulnerable binary matrix, not JSON/base64 state. Do not reintroduce compression or opaque serialization unless there is still a deliberately editable layer. The body must remain byte-addressable enough for hex/text damage to matter.
-  Protect the header, expose the body. The first 16 bytes define the decoding frame. Damage tools should generally preserve the URMZ header unless the user is intentionally testing catastrophic invalidation. The body is the artistic damage surface.
-  Tolerant decode is part of the poetics. Length changes, truncation, and misalignment should degrade into partial fields, shears, dry gaps, or channel faults when possible. A corrupted .urumizuri should not aspire to normal file safety; it should aspire to performable damage.
-  Do not confuse image filters with wet-state damage. urumizuri.html does not filter pixels. It mutates the encoded wet field: fixation, spatial order, and ink-load channels.
- The chain is now driven by a headless reducer (`bakezuri-chain.js`, mirrored inline in `index.html`, kept in sync manually until the `bakezuri-core.js` extraction). 24 transition tests + 9 host-glue integration tests, all passing.
- Deposits are deterministic by construction (no per-call RNG anywhere in `applyDeposit`) — this is *why* mark-level undo-by-replay and separate-as-pending-deposit both work. If a future deposit type introduces randomness, this assumption breaks and needs revisiting.
---

## 10. Function map (where things live)

- **Field / lifecycle:** `alloc`, `addInk`/`removeInk`, `snapshotField`/`restoreField`/`trimSnaps`/`lastSnap`.
- **Chain:** `commitPass`/`commitBleed`/`scrubTo`/`trimSnaps`/`lastSnap`/`undo` → `dispatch`, `flushPending`, `addMark`, `bleedSteps`, `undoOrRevert`, `selectChip`, `resetChain`, backed by `BakezuriChain.{createInitialState,applyEvent,...}`.
  `pendingBleed`, `pendingSeparation`.
- **Sim:** `step` (diffusion + grain feather + water repulsion + fix), `disguised` (the slider bundle).
- **Deposition:** `depositInk` (conserved), `depositSurfactant` (impulse push), `depositWaterScreen`,
  `cellHash` (jitter), `applyDeposit` (dispatch).
- **Resolve:** `computeField` (subtractive + glow/duo/iridescent + screen + alpha), `screenThresh`,
  `thinfilm`, `hueShift`, `lerp3`, `resolve`, `paintPaperAll`.
- **Separation:** `separateImage` (NNLS multiplicative update, overlay/rollback logic), `halftoneDeposit`.
- **Image utils:** `loadImageFile`, `#dropzone` IIFE (drag-drop).
- **Saves/loads:** `exportPNG`, `saveBake` (recipe v2), `saveUrumi` (wet v1), `f32ToB64`/`b64ToF32`,
  `loadParamsAndInks`, `replayChain`, open handlers.
- **i18n:** `I18N`, `t`, `setLang`, `#langBtn`.
- **Tuning constants:** `NUM_INKS` (dynamic), `MAX_SNAPS=18`, `STOCK`, `bg`, separation `cap=440`/`ITER=26`.

---

## 11. blobSketch study — Lagrangian lessons for a field engine (2026-07-03)

Read `F:\xyhtamura\blobSketch-main\index.html` (single-file WebGL soft-body toy) as a reference for
liquid interaction feel. It is the **opposite architecture** — Lagrangian (blobs = closed chains of
point-masses with springs) vs our Eulerian field — which is exactly why it's instructive: it shows
what boundary-based liquids do that pure diffusion can't. Line refs are into that file.

**Transferable:**

1. **Comb/rake = their attractor path** (`simulateAttractorRepulsorForces`, ~line 13679). A drawn
   path exerts force on nearby points with distance falloff; a *tangential-flow mode* pushes along
   the path direction, modulated by a per-path **gradient curve** (strength varying along the path —
   steal this UI idea). Field version: `{tool:'rake', path, strength}` deposit that advects load
   along the path tangent — same upwind mass-conserving machinery as water repulsion, sign-flipped
   to follow a drawn direction instead of a water hill. ⚠ Their temporal modes use `Date.now()` —
   would break our "deposits deterministic by construction" invariant (§9). Time must be pass-local
   or absent.

2. **Immiscibility (roadmap #1) sharpened.** Their drops jostle-but-don't-blend via *pairwise-
   asymmetric* repulsion: cohesion within a chain (1.0), repulsion across chains (`interRepelMult`).
   Generalizes our planned boolean `repels` flag to a **per-ink-pair repulsion coefficient**. And it
   exposes the missing half: territorial inks need *self-cohesion*, not just other-repulsion — in
   field terms an ink advecting gently **up its own gradient** (Cahn–Hilliard-style phase
   separation). That's what gives a drop a held boundary instead of Gaussian smear.

3. **Runaway-proofing recipe** (turgor controller, lines ~13354–13508). Their inflation is an
   area-target feedback loop stabilized by: tanh-saturated error, an opposing Hookean tension term,
   hysteresis at rest, normal-velocity damping, and a hard per-edge force clamp. Any self-cohesion /
   anti-diffusion term we add for #2 is the same species of positive feedback — apply the same
   recipe (saturate the sharpening term, oppose with diffusion, clamp per cell, hysteresis near
   equilibrium).

4. **Wetness envelope.** Their "excitability poke" (damping drops instantly, eases back over ~300ms)
   is what makes interaction feel alive. Field analog: a deposit carries transient extra mobility —
   fresh ink diffuses eagerly, settles as it "dries." One per-deposit scalar decaying over steps.

**Do NOT copy:** the ambient noise field. Bleed is deliberate, not ambient (§2 doctrine); their
always-wobbling idle state is charming there, doctrine-breaking here.

### Jaffer-style mathematical marbling (the physics thread — Xyh exploring personally)

blobSketch's chains resemble how **mathematical marbling** (Aubrey Jaffer; also Lu et al.,
"Mathematical Marbling", IEEE CG&A 2012) models suminagashi: each gesture is a **closed-form,
invertible, area-preserving displacement map** of the plane, and the picture is the composition of
those maps. The two primitives:

- **Drop** of radius `r` at centre `c`: every existing point `p` moves outward to
  `p' = c + (p − c) · √(1 + r² / |p − c|²)`. Pushes prior ink aside conservatively; iterated drops
  give the concentric-ring suminagashi pattern for free.
- **Tine / comb stroke** along a line with unit direction `m`, point `a` on the line: points shift
  parallel to the line by `α · λ / (λ + d)` where `d` = perpendicular distance from the line, `α` =
  max displacement, `λ` = falloff scale. A comb = several parallel tines composed.

Application to our engine: apply to the `Float32Array` load fields by **backward mapping** (for each
cell, invert the transform, sample source field bilinearly). Properties that make it doctrine-clean:
deterministic (replayable from `.bakezuri` — no RNG), single-shot (no per-frame cost; composes with
bleed rather than competing with it), and near-mass-conserving (the maps are measure-preserving;
bilinear resampling is the only leak — worth quantifying, see below). A `drop`/`comb` displacement
deposit + existing diffusion may be the **shortest path to real marbling**: Jaffer supplies the
rings and the comb, the wet field supplies what Jaffer can't — bleed, grain, water, fixing.

Physics things to explore (Xyh):
- The drop map is the incompressible radial flow of a point source integrated to time-∞ — connect to
  Stokes/potential flow and to why real suminagashi rings stay sharp (advection ≫ diffusion, high
  Péclet number; our disguise slider effectively *is* a Péclet knob).
- Exact inverse of the drop map: `p = c + (p' − c) · √(1 − r² / |p' − c|²)` for `|p' − c| > r`;
  cells landing *inside* radius `r` have no preimage — that's where the *new* drop's ink goes.
  The comb map inverts by negating the displacement.
- Mass conservation under repeated backward-resampling: measure the drift, decide if it needs a
  renormalization pass (divide by resampled total per ink) or if the leak is acceptable poetics.
- Composition order = sequence-as-material (§1) restated as maps: later gestures deform earlier
  ink — the same "an ink mixes with what came before it, never after," now geometric.

---

**Roadmap (§8) — mark #1 done**, with the caveat that `committedInkCount` is currently held together by a stopgap `inkLockBaseline` rather than the real ink-lifecycle model.

*Stopping point: riso/marbling instrument is feature-complete enough to harden. Next concrete steps
are §8 items 1–3, then modularize (§8.5) before forking the suminagashi tool (§8.7).*
