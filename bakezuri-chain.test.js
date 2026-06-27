/* ════════════════════════════════════════════════════════════════════════
   bakezuri-chain.test.js — exhaustive transition-table tests, zero deps.
   Run: node bakezuri-chain.test.js
   ════════════════════════════════════════════════════════════════════════ */

var C = require('./bakezuri-chain.js');

// ── tiny harness ───────────────────────────────────────────────────────────
var passed = 0, failed = 0, current = '';
function test(name, fn) {
  current = name;
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); }
}
function eq(a, b, msg) {
  var sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || 'eq') + ': expected ' + sb + ' got ' + sa);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

// ── mock field: records its call log; snapshots are sentinels ──────────────
function mockField() {
  var counter = 0, log = [];
  return {
    log: log,
    snapshot: function () { var s = { snapId: ++counter }; log.push('snap#' + s.snapId); return s; },
    restore: function (snap) { log.push('restore:' + (snap ? snap.snapId : 'null')); },
    applyDeposit: function (ev) { log.push('apply:' + ev.tag); },
    resolve: function () { log.push('resolve'); }
  };
}

// helpers
function dep(tag, tool) { return { t: 'deposit', ev: { tag: tag, tool: tool || 'ink' } }; }
function fresh() { var s = C.createInitialState(); s.maxSnaps = 64; return s; }
function kinds(s) { return s.chain.map(function (n) { return n.kind; }); }
function depTags(node) { return node.deposits.map(function (d) { return d.tag; }); }

// Build a small committed history: ink(a,b) -> bleed(10) -> ink(c) , at head.
function seeded() {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  C.applyEvent(s, dep('b'), f);
  C.applyEvent(s, { t: 'flushPending' }, f);     // commit ink#1 {a,b}
  C.applyEvent(s, { t: 'commitBleed', n: 10 }, f); // commit bleed
  C.applyEvent(s, dep('c'), f);
  C.applyEvent(s, { t: 'flushPending' }, f);     // commit ink#2 {c}
  return { s: s, f: f };
}

console.log('\nbakezuri-chain — transition table\n');

// ── DEPOSIT ────────────────────────────────────────────────────────────────
test('deposit at head opens a pending ink pass and applies live', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  ok(s.pending && s.pending.type === 'ink', 'pending ink opened');
  eq(s.pending.deposits.map(function (d) { return d.tag; }), ['a']);
  eq(s.chain.length, 0, 'nothing committed yet');
  eq(f.log, ['apply:a', 'resolve']);
});

test('multiple deposits accumulate in ONE pending pass (any-mix sequential)', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a', 'ink'), f);
  C.applyEvent(s, dep('s', 'separate'), f);
  C.applyEvent(s, dep('w', 'waterscreen'), f);
  eq(s.pending.deposits.map(function (d) { return d.tag; }), ['a', 's', 'w']);
  eq(s.chain.length, 0);
});

// ── UNDO (pending, mark-level by re-derivation) ────────────────────────────
test('undo with pending peels last deposit and re-derives from base', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  C.applyEvent(s, dep('b'), f);
  f.log.length = 0;
  C.applyEvent(s, { t: 'undo' }, f);
  eq(s.pending.deposits.map(function (d) { return d.tag; }), ['a'], 'b peeled');
  // base = lastSnap = null (no committed nodes) -> restore:null, replay a
  eq(f.log, ['restore:null', 'apply:a', 'resolve']);
});

test('undo down to empty clears pending entirely', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  C.applyEvent(s, { t: 'undo' }, f);
  eq(s.pending, null, 'pending cleared');
});

// ── THE BUG WE FIXED: separate-only pending must not eat an underlayer ──────
test('undo with a separate-only pending clears pending, does NOT pop a node', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;   // 3 nodes committed, at head
  C.applyEvent(s, dep('sep', 'separate'), f);          // pending = one separate deposit
  var before = s.chain.length;
  f.log.length = 0;
  C.applyEvent(s, { t: 'undo' }, f);
  eq(s.pending, null, 'pending separate cleared');
  eq(s.chain.length, before, 'no committed node consumed');
  // re-derive base = lastSnap (ink#2 snap) then replay nothing
  ok(f.log[0].indexOf('restore:') === 0, 'restored to base');
});

// ── UNDO (node-level, no pending) ──────────────────────────────────────────
test('undo with no pending pops the head node and restores new head', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  eq(kinds(s), ['ink', 'bleed', 'ink']);
  f.log.length = 0;
  C.applyEvent(s, { t: 'undo' }, f);
  eq(kinds(s), ['ink', 'bleed'], 'head ink popped');
  ok(f.log.indexOf('restore:' + s.chain[s.chain.length - 1].snap.snapId) >= 0, 'restored to new head snap');
});

test('undo on an empty chain is a no-op', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, { t: 'undo' }, f);
  eq(s.chain.length, 0); eq(s.pending, null);
});

// ── FLUSH PENDING ──────────────────────────────────────────────────────────
test('flushPending commits the ink node with a snapshot and clears pending', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  C.applyEvent(s, dep('b'), f);
  C.applyEvent(s, { t: 'flushPending' }, f);
  eq(kinds(s), ['ink']);
  eq(depTags(s.chain[0]), ['a', 'b']);
  ok(s.chain[0].snap != null, 'ink node snapshotted');
  eq(s.pending, null);
});

test('flushPending with nothing pending at head is a no-op', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, { t: 'flushPending' }, f);
  eq(s.chain.length, 0);
  eq(f.log, []);
});

// ── BLEED FLOW (flush + commitBleed) ───────────────────────────────────────
test('bleed after pending: flushPending then commitBleed yields ink THEN bleed', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  C.applyEvent(s, { t: 'flushPending' }, f);     // host does this on play-start/chunk
  // host runs steps here (not through reducer)
  C.applyEvent(s, { t: 'commitBleed', n: 25 }, f);
  eq(kinds(s), ['ink', 'bleed']);
  eq(s.chain[1].steps, 25);
});

test('commitBleed with no pending just records the bleed node', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, { t: 'commitBleed', n: 5 }, f);
  eq(kinds(s), ['bleed']);
  eq(s.chain[0].steps, 5);
});

test('commitBleed throws if pending is still open (protocol guard)', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f);
  var threw = false;
  try { C.applyEvent(s, { t: 'commitBleed', n: 5 }, f); } catch (e) { threw = true; }
  ok(threw, 'must flush before commitBleed');
});

// ── PREVIEW (non-destructive) ──────────────────────────────────────────────
test('selectChip historical stashes return, restores node snap, leaves chain+pending intact', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  C.applyEvent(s, dep('z'), f);                    // open a pending pass
  var chainLenBefore = s.chain.length;
  f.log.length = 0;
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f); // preview oldest node
  eq(s.previewIdx, 0);
  ok(s.previewReturn != null, 'return field stashed');
  eq(s.chain.length, chainLenBefore, 'chain untouched');
  ok(s.pending && depTags(s.pending) , 'pending untouched');
  eq(depTags(s.pending), ['z']);
  // stash snapshot, then restore node 0 snap
  ok(f.log[0].indexOf('snap#') === 0, 'stashed via snapshot');
  ok(f.log.indexOf('restore:' + s.chain[0].snap.snapId) >= 0, 'restored node 0 snap');
});

test('selectChip head while previewing returns to head and exits preview', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f); // enter preview
  var ret = s.previewReturn.snapId;
  f.log.length = 0;
  C.applyEvent(s, { t: 'selectChip', idx: C.headIndex(s) }, f);
  eq(s.previewIdx, null, 'exited preview');
  eq(s.previewReturn, null);
  ok(f.log.indexOf('restore:' + ret) >= 0, 'restored stashed head');
});

test('selectChip to another historical node while previewing moves view, does NOT re-stash', function () {
  // need >=2 historical nodes: build ink,bleed,ink,bleed,ink (head idx 4)
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('a'), f); C.applyEvent(s, { t: 'flushPending' }, f);
  C.applyEvent(s, { t: 'commitBleed', n: 3 }, f);
  C.applyEvent(s, dep('b'), f); C.applyEvent(s, { t: 'flushPending' }, f);
  C.applyEvent(s, { t: 'commitBleed', n: 3 }, f);
  C.applyEvent(s, dep('c'), f); C.applyEvent(s, { t: 'flushPending' }, f);
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f);
  var stash = s.previewReturn.snapId;
  C.applyEvent(s, { t: 'selectChip', idx: 2 }, f);
  eq(s.previewIdx, 2, 'moved to node 2');
  eq(s.previewReturn.snapId, stash, 'return stash unchanged (no re-stash)');
});

test('selectChip refuses a trimmed (null-snap) node', function () {
  var s = fresh(), f = mockField();
  s.chain.push({ kind: 'ink', deposits: [], snap: null });  // simulate trimmed
  s.chain.push({ kind: 'bleed', steps: 1, snap: { snapId: 99 } });
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f);
  eq(s.previewIdx, null, 'refused: not previewable');
});

// ── DEPOSIT / BLEED WHILE PREVIEWING (snap to head, then act) ──────────────
test('deposit while previewing exits preview then appends; chain intact', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f);
  var ret = s.previewReturn.snapId, len = s.chain.length;
  f.log.length = 0;
  C.applyEvent(s, dep('new'), f);
  eq(s.previewIdx, null, 'exited preview');
  eq(s.chain.length, len, 'chain untouched');
  eq(depTags(s.pending), ['new']);
  eq(f.log[0], 'restore:' + ret, 'restored head before depositing');
  ok(f.log.indexOf('apply:new') >= 0);
});

test('flushPending while previewing exits preview then commits pending', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  C.applyEvent(s, dep('p'), f);                     // pending open
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f);  // preview
  var len = s.chain.length;
  C.applyEvent(s, { t: 'flushPending' }, f);
  eq(s.previewIdx, null, 'exited preview');
  eq(s.chain.length, len + 1, 'pending committed');
  eq(depTags(s.chain[s.chain.length - 1]), ['p']);
});

// ── UNDO IS A NO-OP WHILE PREVIEWING (button is REVERT) ────────────────────
test('undo while previewing is a no-op', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f);
  var len = s.chain.length;
  C.applyEvent(s, { t: 'undo' }, f);
  eq(s.chain.length, len, 'chain untouched');
  eq(s.previewIdx, 0, 'still previewing');
});

// ── REVERT (destructive truncate) ──────────────────────────────────────────
test('revert while previewing truncates to idx+1, restores snap, clears pending+preview', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;  // [ink,bleed,ink]
  C.applyEvent(s, dep('p'), f);                      // open a pending pass
  C.applyEvent(s, { t: 'selectChip', idx: 1 }, f);   // preview the bleed node
  f.log.length = 0;
  C.applyEvent(s, { t: 'revert' }, f);
  eq(kinds(s), ['ink', 'bleed'], 'truncated to idx 1');
  eq(s.pending, null, 'pending discarded (destructive)');
  eq(s.previewIdx, null);
  eq(s.previewReturn, null);
  ok(f.log.indexOf('restore:' + s.chain[1].snap.snapId) >= 0, 'restored node-1 snap');
});

test('revert while not previewing is a no-op', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  var len = s.chain.length;
  C.applyEvent(s, { t: 'revert' }, f);
  eq(s.chain.length, len);
});

// ── BUTTON LABEL ───────────────────────────────────────────────────────────
test('buttonLabel is "undo" at head and "revert" while previewing', function () {
  var seed = seeded(); var s = seed.s, f = seed.f;
  eq(C.buttonLabel(s), 'undo');
  C.applyEvent(s, { t: 'selectChip', idx: 0 }, f);
  eq(C.buttonLabel(s), 'revert');
});

// ── TRIM / MAX_SNAPS ───────────────────────────────────────────────────────
test('trim nulls snaps older than maxSnaps; head stays previewable, undo still works', function () {
  var s = fresh(), f = mockField(); s.maxSnaps = 3;
  // commit 5 ink nodes
  for (var i = 0; i < 5; i++) { C.applyEvent(s, dep('n' + i), f); C.applyEvent(s, { t: 'flushPending' }, f); }
  eq(s.chain.length, 5);
  ok(s.chain[0].snap == null && s.chain[1].snap == null, 'oldest two trimmed');
  ok(s.chain[4].snap != null && s.chain[3].snap != null, 'recent kept');
  // older chips not previewable, recent ones are
  ok(!C.canPreview(s, 0), 'trimmed node not previewable');
  ok(C.canPreview(s, 3), 'recent node previewable');
  // undo still restores the new head snapshot
  C.applyEvent(s, { t: 'undo' }, f);
  eq(s.chain.length, 4);
});

// ── INTEGRATION: the ink scenario (try, dislike, bleed-first, recommit) ────
test('scenario: mark, undo the mark, switch to bleed (auto-commit nothing), bleed commits', function () {
  var s = fresh(), f = mockField();
  C.applyEvent(s, dep('trial'), f);          // lay a trial mark
  C.applyEvent(s, { t: 'undo' }, f);         // dislike it -> mark-level undo
  eq(s.pending, null, 'trial cleared, nothing pending');
  C.applyEvent(s, { t: 'flushPending' }, f); // tool switch to bleed: nothing to commit
  C.applyEvent(s, { t: 'commitBleed', n: 8 }, f);
  eq(kinds(s), ['bleed'], 'only the bleed committed; no empty ink node');
});

// ── results ────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
