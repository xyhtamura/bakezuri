/* Integration harness: mirrors index.html's host glue (dispatch, flushPending,
   bleedSteps, play/pause, separateImage, replayChain, saveBake) over the real
   reducer with a mock field. Proves the SEQUENCES, not just the transitions. */
var Chain = require('./bakezuri-chain.js');

var passed = 0, failed = 0;
function test(n, fn){ try{ fn(); passed++; console.log('  ok   '+n);}catch(e){ failed++; console.log('  FAIL '+n+'\n        '+e.message);} }
function eq(a,b,m){ var sa=JSON.stringify(a),sb=JSON.stringify(b); if(sa!==sb) throw new Error((m||'eq')+': exp '+sb+' got '+sa);}
function ok(c,m){ if(!c) throw new Error(m||'falsy'); }

// ── mock bath: tracks an integer "field" = sum of applied deposit weights, plus
//    fix; snapshots capture {field}; restore sets it; replay re-applies. ───────
function makeHost(){
  var H = { field:0, P:{pitch:7, mixing:'subtractive'}, running:false, playSteps:0,
            inkLockBaseline:0, committedInkCount:0, NUM_INKS:4, log:[] };
  var snapId = 0;
  var fieldIO = {
    snapshot: function(){ return { snapId:++snapId, field:H.field, n:H.NUM_INKS }; },
    restore: function(s){ H.field = s ? s.field : 0; },
    applyDeposit: function(ev){
      if(ev.tool==='separate') H.field += 100;           // halftone bulk deposit
      else if(ev.tool==='waterscreen') H.field += 10;
      else H.field += (ev.amount||1);
    },
    resolve: function(){ H.log.push('resolve'); }
  };
  var s = Chain.createInitialState();
  function syncCount(){ var fc = s.chain.length ? s.chain[s.chain.length-1].snap.n : 0; H.committedInkCount = Math.max(H.inkLockBaseline, fc); }
  function dispatch(ev){ Chain.applyEvent(s, ev, fieldIO); syncCount(); }
  function flushPending(){
    var before = s.chain.length; dispatch({t:'flushPending'}); var after = s.chain.length;
    if(after>before){ var node=s.chain[after-1]; if(node.kind==='ink' && !node.settings) node.settings={pitch:H.P.pitch, mixing:H.P.mixing}; }
  }
  function addMark(ev){ dispatch({t:'deposit', ev:ev}); }
  function bleedSteps(n){ if(H.running) return; flushPending(); H.field += 0; /*steps are stochastic, field unchanged in mock*/ dispatch({t:'commitBleed', n:n}); }
  function play(){ if(H.running) return; flushPending(); H.playSteps=0; H.running=true; }
  function pause(){ if(!H.running) return; H.running=false; if(H.playSteps>0) dispatch({t:'commitBleed', n:H.playSteps}); H.playSteps=0; }
  function resetChain(){ s = Chain.createInitialState(); H.inkLockBaseline=0; syncCount(); }
  function separate(iw, ih, W, Hh){
    var sizeChanged = (W!==iw || Hh!==ih);
    if(sizeChanged){ resetChain(); }
    else { flushPending(); fieldIO.restore(Chain.lastSnap(s)); }
    dispatch({t:'deposit', ev:{tool:'separate', sep:'SEPDATA', pitch:H.P.pitch}});
  }
  return { H:H, get s(){return s;}, dispatch:dispatch, flushPending:flushPending, addMark:addMark,
           bleedSteps:bleedSteps, play:play, pause:pause, resetChain:resetChain, separate:separate, fieldIO:fieldIO };
}
function kinds(s){ return s.chain.map(function(n){return n.kind;}); }

console.log('\nbakezuri host-glue integration\n');

test('mark, mark, +40 bleed, mark, commit → [ink{2}, bleed{40}, ink{1}]', function(){
  var h = makeHost();
  h.addMark({tool:'ink', ink:0, amount:1}); h.addMark({tool:'ink', ink:0, amount:1});
  h.bleedSteps(40);
  h.addMark({tool:'ink', ink:1, amount:1});
  h.flushPending();
  eq(kinds(h.s), ['ink','bleed','ink']);
  eq(h.s.chain[0].deposits.length, 2);
  eq(h.s.chain[1].steps, 40);
  ok(h.s.chain[0].settings && h.s.chain[0].settings.pitch===7, 'settings stamped on ink node');
});

test('THE BUG: separate on EMPTY then undo clears pending, no node, no crash', function(){
  var h = makeHost();
  h.separate(440, 440, 440, 440);             // empty bath, size matches default -> overlay path; chain empty
  ok(h.s.pending && h.s.pending.deposits.length===1, 'separate is pending');
  ok(h.s.pending.deposits[0].tool==='separate');
  h.dispatch({t:'undo'});
  eq(h.s.pending, null, 'pending cleared');
  eq(h.s.chain.length, 0, 'no phantom node popped');
});

test('THE BUG: separate over committed layers, undo restores head, chain intact', function(){
  var h = makeHost();
  h.addMark({tool:'ink', ink:0, amount:2}); h.flushPending();   // ink node, field=2
  h.bleedSteps(10);                                              // bleed node
  var headField = h.s.chain[h.s.chain.length-1].snap.field;
  h.separate(440,440,440,440);                                   // overlay separate (size match)
  ok(h.H.field >= headField+100, 'separation deposited onto head');
  var lenBefore = h.s.chain.length;
  h.dispatch({t:'undo'});
  eq(h.s.chain.length, lenBefore, 'no committed node consumed');
  eq(h.H.field, headField, 'field restored to committed head (separation removed)');
});

test('separate with a size change resets the chain (explicit new bath)', function(){
  var h = makeHost();
  h.addMark({tool:'ink', ink:0, amount:1}); h.flushPending();
  h.bleedSteps(5);
  eq(h.s.chain.length, 2);
  h.separate(300, 220, 440, 440);   // different size -> reset to fresh bath
  eq(kinds(h.s), [], 'committed chain reset to empty');
  // separate sits pending on the fresh chain — undoable, not auto-committed
  ok(h.s.pending && h.s.pending.deposits[0].tool==='separate', 'separate is pending on fresh bath');
});

test('play → pause with steps commits exactly one bleed node', function(){
  var h = makeHost();
  h.addMark({tool:'ink', ink:0, amount:1});
  h.play();                          // flushes the mark into an ink node
  eq(kinds(h.s), ['ink']);
  h.H.playSteps = 33;                // simulate frames
  h.pause();
  eq(kinds(h.s), ['ink','bleed']);
  eq(h.s.chain[1].steps, 33);
});

test('play → pause with zero steps commits nothing', function(){
  var h = makeHost();
  h.play(); h.pause();
  eq(h.s.chain.length, 0);
});

test('saveBake mapping: committed only, separate deposits stripped, pending excluded', function(){
  var h = makeHost();
  h.addMark({tool:'ink', ink:0, amount:1}); h.flushPending();   // ink node
  h.separate(440,440,440,440); h.flushPending();                // separate committed as ink node
  h.addMark({tool:'ink', ink:2, amount:1});                     // a PENDING mark (uncommitted)
  // mirror saveBake's mapping:
  var saved = h.s.chain.map(function(n){
    return n.kind==='bleed' ? {kind:'bleed', steps:n.steps}
      : {kind:'ink', deposits:n.deposits.filter(function(d){return d.tool!=='separate';}), settings:n.settings||{}};
  });
  eq(saved.length, 2, 'two committed nodes (pending mark excluded)');
  eq(saved[1].deposits.length, 0, 'separate deposit stripped from saved node');
  ok(h.s.pending && h.s.pending.deposits.length===1, 'pending mark still live in session');
});

test('replayChain round-trips committed marks + bleeds (separate skipped)', function(){
  var h = makeHost();
  h.addMark({tool:'ink', ink:0, amount:1}); h.addMark({tool:'ink', ink:1, amount:1}); h.flushPending();
  h.bleedSteps(12);
  h.separate(440,440,440,440); h.flushPending();
  // saved form:
  var saved = h.s.chain.map(function(n){
    return n.kind==='bleed' ? {kind:'bleed', steps:n.steps}
      : {kind:'ink', deposits:n.deposits.filter(function(d){return d.tool!=='separate';}), settings:n.settings};
  });
  // replay into a fresh host (mirror replayChain):
  var r = makeHost();
  r.resetChain();
  saved.forEach(function(node){
    if(node.kind==='bleed'){ r.flushPending(); r.dispatch({t:'commitBleed', n:node.steps}); }
    else { (node.deposits||[]).forEach(function(ev){ if(ev.tool!=='separate') r.dispatch({t:'deposit', ev:ev}); }); r.flushPending(); }
  });
  // the separate-only node replays to an empty ink pass -> flushPending commits nothing
  eq(kinds(r.s), ['ink','bleed'], 'marks + bleed replayed; empty separate pass dropped');
  eq(r.s.chain[0].deposits.length, 2);
  eq(r.s.chain[1].steps, 12);
});

test('inkLockBaseline locks loaded inks even with empty chain', function(){
  var h = makeHost();
  h.resetChain();
  h.H.inkLockBaseline = 5;            // simulate a loaded .urumizuri with 5 inks
  h.dispatch({t:'deposit', ev:{tool:'ink', ink:0, amount:1}});  // any dispatch re-syncs count
  ok(h.H.committedInkCount >= 5, 'loaded inks stay locked: '+h.H.committedInkCount);
});

console.log('\n'+passed+' passed, '+failed+' failed\n');
process.exit(failed?1:0);
