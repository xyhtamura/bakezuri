/* ════════════════════════════════════════════════════════════════════════
   bakezuri-chain.js  —  the process-chain state machine (rework #1)

   A headless, zero-dependency reducer for the commit / undo / revert /
   preview lifecycle. It owns ONLY chain + pending + preview metadata. It
   never touches Float32Arrays directly; it drives the real bath through an
   injected `field` interface, so the exact same logic runs under Node with
   a mock field for testing.

   ── doctrine (settled) ───────────────────────────────────────────────────
   • A pass is single-type at the CATEGORY level: { ink, bleed }.
     - ink   : an ordered bag of deposit events (hand mark / separate /
               water-screen / surfactant — all "ink" category). This is the
               only thing that is ever PENDING.
     - bleed : a run of N stochastic steps. Never pending; eager-commits.
   • pending is therefore always null or { type:'ink', deposits:[…] }.
   • Deposits are deterministic ⇒ mark-level undo by re-derivation
     (restore the pass's base snapshot, replay the surviving deposits).
   • Bleeds are stochastic ⇒ snapshot-bounded; peeled whole, never shaved.
   • Preview is a non-destructive viewing detour. Only REVERT truncates.
   • Auto-commit bias: crossing ink→bleed flushes pending into the chain
     rather than discarding it (revert is cheap, a lost pending is forever).

   ── the injected `field` interface ───────────────────────────────────────
     field.snapshot()        -> opaque snap (prod: {load,fix,n})
     field.restore(snap|null)-> restore field; null = clear to zero
     field.applyDeposit(ev)  -> deposit one event onto the live field
     field.resolve()         -> re-render
   The host owns step()/runSteps — the reducer never runs bleed steps. For a
   chunk press the host does: flushPending(); runSteps(n); commitBleed(n).
   For play the host does: flushPending() on start; runSteps(1) per frame;
   commitBleed(total) on stop. Either way pending is flushed BEFORE stepping,
   so the ink node snapshots the pre-bleed field.

   ── node shape ───────────────────────────────────────────────────────────
     { kind:'ink',   deposits:[ev…], snap }
     { kind:'bleed', steps:N,        snap }
   (separate is just an ink node whose deposits carry image-derived events;
    that distinction is #2's concern, invisible here.)
   ════════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakezuriChain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Snapshot ring depth. Memory per snap ≈ (1 + NUM_INKS) · W·H · 4 bytes.
  // e.g. 440×440 · 5 channels ≈ 3.9 MB/snap; 64 snaps ≈ 250 MB worst case.
  // Bump with care once #2 lets channel count grow; delta-snaps are the
  // real long-term fix. Overridable via opts.maxSnaps.
  var DEFAULT_MAX_SNAPS = 64;

  function createInitialState() {
    return {
      chain: [],            // committed nodes (newest last)
      pending: null,        // null | { type:'ink', deposits:[ev…] }
      previewIdx: null,     // null (at head) | index of previewed node
      previewReturn: null,  // null | snap of live head (incl. pending) stashed on entering preview
      maxSnaps: DEFAULT_MAX_SNAPS
    };
  }

  // ── pure helpers ─────────────────────────────────────────────────────────
  function headIndex(s) { return s.chain.length - 1; }
  function isPreviewing(s) { return s.previewIdx !== null; }
  function lastSnap(s) { return s.chain.length ? s.chain[s.chain.length - 1].snap : null; }

  // Is a chip previewable? Not the head, has a (non-trimmed) snapshot.
  function canPreview(s, idx) {
    return idx >= 0 && idx < s.chain.length && idx !== headIndex(s) && s.chain[idx].snap != null;
  }

  // The contextual button label. One button, two honest verbs.
  function buttonLabel(s) { return isPreviewing(s) ? 'revert' : 'undo'; }

  function trim(s) {
    var cut = s.chain.length - s.maxSnaps;
    for (var i = 0; i < cut; i++) s.chain[i].snap = null;
  }

  // Leave preview: snap the field back to the live head (incl. pending) and
  // clear preview metadata. Safe to call whether or not we're previewing.
  function exitPreviewToHead(s, field) {
    if (!isPreviewing(s)) return;
    field.restore(s.previewReturn);
    s.previewIdx = null;
    s.previewReturn = null;
  }

  // ── the reducer ───────────────────────────────────────────────────────────
  // applyEvent(state, event, field) -> state (same object, mutated in place).
  // Deterministic given (state, event, field): fully Node-testable.
  function applyEvent(s, ev, field) {
    switch (ev.t) {

      // ── DEPOSIT ── append to the (possibly new) pending ink pass ──────────
      case 'deposit': {
        exitPreviewToHead(s, field);            // a deposit while previewing snaps to head first
        if (!s.pending) s.pending = { type: 'ink', deposits: [] };
        s.pending.deposits.push(ev.ev);
        field.applyDeposit(ev.ev);
        field.resolve();
        return s;
      }

      // ── FLUSH PENDING ── commit an open ink pass (auto-commit / pre-bleed) ─
      // Called: on tool-switch into bleed, and at play-start. No-op if nothing
      // is pending (after exiting any preview).
      case 'flushPending': {
        exitPreviewToHead(s, field);
        if (s.pending) {
          var snap = field.snapshot();          // field = base + pending deposits
          s.chain.push({ kind: 'ink', deposits: s.pending.deposits, snap: snap });
          s.pending = null;
          trim(s);
          field.resolve();
        }
        return s;
      }

      // ── COMMIT BLEED ── record a completed bleed run ─────────────────────
      // Protocol: host has ALREADY flushPending()'d and runSteps()'d. We only
      // snapshot the post-bleed field and append the node. Must NOT flush here
      // (would snapshot the post-step field into the ink node) — assert clean.
      case 'commitBleed': {
        if (s.pending) throw new Error('commitBleed called with pending open — flushPending first');
        if (isPreviewing(s)) exitPreviewToHead(s, field); // defensive
        var bsnap = field.snapshot();
        s.chain.push({ kind: 'bleed', steps: ev.n, snap: bsnap });
        trim(s);
        field.resolve();
        return s;
      }

      // ── UNDO ── fine-grained backward step (head only) ───────────────────
      case 'undo': {
        if (isPreviewing(s)) return s;          // button is 'revert' while previewing
        if (s.pending && s.pending.deposits.length) {
          // peel one deposit; re-derive by replay from the pass base
          s.pending.deposits.pop();
          field.restore(lastSnap(s));
          for (var i = 0; i < s.pending.deposits.length; i++) field.applyDeposit(s.pending.deposits[i]);
          if (s.pending.deposits.length === 0) s.pending = null;
          field.resolve();
        } else if (s.chain.length) {
          s.chain.pop();
          field.restore(lastSnap(s));           // new head's snap, or null if empty
          field.resolve();
        }
        return s;
      }

      // ── REVERT ── deliberate destructive jump (previewing only) ──────────
      case 'revert': {
        if (!isPreviewing(s)) return s;
        var idx = s.previewIdx;
        s.chain = s.chain.slice(0, idx + 1);
        field.restore(s.chain[idx].snap);
        s.pending = null;
        s.previewIdx = null;
        s.previewReturn = null;
        field.resolve();
        return s;
      }

      // ── SELECT CHIP ── enter/move/exit non-destructive preview ───────────
      case 'selectChip': {
        var i2 = ev.idx;
        // clicking the head chip returns to head (incl. pending) if previewing
        if (i2 === headIndex(s)) {
          if (isPreviewing(s)) { exitPreviewToHead(s, field); field.resolve(); }
          return s;
        }
        if (!canPreview(s, i2)) return s;        // refuse head / trimmed / OOB
        if (!isPreviewing(s)) s.previewReturn = field.snapshot(); // stash live head ONCE
        s.previewIdx = i2;
        field.restore(s.chain[i2].snap);
        field.resolve();
        return s;
      }

      default:
        return s;
    }
  }

  return {
    createInitialState: createInitialState,
    applyEvent: applyEvent,
    // pure selectors (for the host UI)
    headIndex: headIndex,
    isPreviewing: isPreviewing,
    canPreview: canPreview,
    buttonLabel: buttonLabel,
    lastSnap: lastSnap,
    DEFAULT_MAX_SNAPS: DEFAULT_MAX_SNAPS
  };
});
