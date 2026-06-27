/* #2 ink-as-library lifecycle — mirrors index.html host glue (lockCount carry,
   flushPending console-lock, commitBleedNode, clearInks, reloadInk, armed-only
   separation) over the real reducer with mock inks + per-channel load. */
var Chain = require('./bakezuri-chain.js');
var passed=0, failed=0;
function test(n,fn){ try{fn();passed++;console.log('  ok   '+n);}catch(e){failed++;console.log('  FAIL '+n+'\n        '+e.message);} }
function eq(a,b,m){ var sa=JSON.stringify(a),sb=JSON.stringify(b); if(sa!==sb) throw new Error((m||'eq')+': exp '+sb+' got '+sa);}
function ok(c,m){ if(!c) throw new Error(m||'falsy'); }

function makeHost(){
  var H={ inks:[], loadA:[], committedInkCount:0, inkLockBaseline:0, NUM_INKS:0, CAP:8 };
  var snapId=0;
  // seed 4 armed default inks
  function spawn(seed){ var i=H.inks.length; H.inks.push(Object.assign({tag:'k'+i},seed||{})); delete H.inks[i].pass; H.loadA.push(0); H.NUM_INKS=H.inks.length; return i; }
  for(var z=0;z<4;z++) spawn();
  var s=Chain.createInitialState();
  var field={
    snapshot:function(){ return {snapId:++snapId, n:H.NUM_INKS, load:H.loadA.slice()}; },
    restore:function(snap){ if(!snap){ for(var k=0;k<H.NUM_INKS;k++) H.loadA[k]=0; } else { for(var k=0;k<H.NUM_INKS;k++) H.loadA[k]= k<snap.load.length?snap.load[k]:0; } },
    applyDeposit:function(ev){ if(ev.tool==='separate'){ for(var k=ev.k0;k<ev.kN;k++) H.loadA[k]+=1; } else H.loadA[ev.ink]+=1; },
    resolve:function(){}
  };
  function consoleCount(){ return H.inks.length - H.committedInkCount; }
  function headLockCount(){ for(var i=s.chain.length-1;i>=0;i--){ if(s.chain[i].lockCount!=null) return s.chain[i].lockCount; } return 0; }
  function syncCount(){ H.committedInkCount=Math.max(H.inkLockBaseline, headLockCount()); }
  function dispatch(ev){ Chain.applyEvent(s,ev,field); syncCount(); }
  function flushPending(){
    var prevC=H.committedInkCount, before=s.chain.length;
    dispatch({t:'flushPending'}); var after=s.chain.length;
    if(after>before){ var node=s.chain[after-1];
      if(node.kind==='ink'){ for(var i=prevC;i<H.inks.length;i++) H.inks[i].pass=after-1; H.committedInkCount=H.inks.length; node.lockCount=H.committedInkCount; syncCount(); } }
  }
  function commitBleedNode(n){ dispatch({t:'commitBleed', n:n}); var node=s.chain[s.chain.length-1]; if(node&&node.kind==='bleed') node.lockCount=H.committedInkCount; }
  function addMark(ink){ dispatch({t:'deposit', ev:{tool:'ink', ink:ink}}); }
  function reloadInk(ci){ if(consoleCount()>=H.CAP) return; var src=H.inks[ci]; return spawn({tag:src.tag+'*'}); }
  function clearInks(){ H.inks.length=H.committedInkCount; H.loadA.length=H.committedInkCount; H.NUM_INKS=H.inks.length; if(H.inks.length===0) spawn(); }
  function separate(){ var k0=H.committedInkCount, kN=H.NUM_INKS; if(kN<=k0) return 'empty'; dispatch({t:'deposit', ev:{tool:'separate', k0:k0, kN:kN}}); return 'ok'; }
  return { H:H, get s(){return s;}, spawn:spawn, consoleCount:consoleCount, dispatch:dispatch, flushPending:flushPending,
           commitBleedNode:commitBleedNode, addMark:addMark, reloadInk:reloadInk, clearInks:clearInks, separate:separate };
}

console.log('\nbakezuri #2 ink-as-library lifecycle\n');

test('ink commit locks the whole armed console; console empties', function(){
  var h=makeHost();                          // 4 armed
  h.addMark(0); h.addMark(1);
  h.flushPending();
  eq(h.H.committedInkCount, 4, 'all 4 armed inks locked');
  eq(h.consoleCount(), 0, 'console empty after run');
  eq(h.s.chain[0].lockCount, 4);
  eq(h.H.inks[0].pass, 0); eq(h.H.inks[3].pass, 0, 'drums tagged with their run');
});

test('bleed carries lockCount forward; freshly-armed inks stay mutable', function(){
  var h=makeHost();
  h.addMark(0); h.flushPending();            // lock 4, console empty
  h.spawn(); h.spawn();                       // arm 2 new
  eq(h.consoleCount(), 2);
  h.commitBleedNode(20);
  eq(h.H.committedInkCount, 4, 'bleed did NOT lock the 2 new armed inks');
  eq(h.s.chain[1].lockCount, 4, 'bleed carried lockCount');
  eq(h.consoleCount(), 2, 'the 2 stay armed');
});

test('undo an ink commit un-locks its drums (console repopulates)', function(){
  var h=makeHost();
  h.addMark(0); h.flushPending();            // committedInkCount 4
  eq(h.H.committedInkCount, 4);
  h.dispatch({t:'undo'});                      // pop the ink node
  eq(h.H.committedInkCount, 0, 'drums un-locked');
  eq(h.consoleCount(), 4, 'all 4 armed again');
});

test('undo bleed leaves lock line intact', function(){
  var h=makeHost();
  h.addMark(0); h.flushPending();            // lock 4
  h.spawn();                                  // arm 1
  h.commitBleedNode(10);
  h.dispatch({t:'undo'});                      // pop bleed
  eq(h.H.committedInkCount, 4, 'still 4 locked');
  eq(h.consoleCount(), 1, 'armed ink survives');
});

test('reload clones a committed drum into a NEW armed channel (growth)', function(){
  var h=makeHost();
  h.addMark(0); h.flushPending();            // lock 4 (channels 0..3)
  var before=h.H.NUM_INKS;
  var idx=h.reloadInk(1);                      // reload committed drum #1
  eq(h.H.NUM_INKS, before+1, 'channel count grew');
  eq(idx, before, 'new slot at the end');
  eq(h.consoleCount(), 1, 'reloaded drum is armed');
  ok(h.H.inks[idx].pass==null, 'fresh slot is uncommitted');
});

test('clear drops every armed ink, never touches committed', function(){
  var h=makeHost();
  h.addMark(0); h.flushPending();            // lock 4
  h.spawn(); h.spawn(); h.spawn();            // arm 3
  eq(h.consoleCount(), 3);
  h.clearInks();
  eq(h.consoleCount(), 0, 'console cleared');
  eq(h.H.committedInkCount, 4, 'committed intact');
  eq(h.H.NUM_INKS, 4, 'only armed channels dropped');
});

test('clear with nothing committed keeps at least one channel', function(){
  var h=makeHost();                          // 4 armed, 0 committed
  h.clearInks();
  ok(h.H.NUM_INKS>=1, 'never zero channels: '+h.H.NUM_INKS);
});

test('console cap blocks arming beyond CAP; committed history uncapped', function(){
  var h=makeHost(); h.H.inks.length=0; h.H.loadA.length=0; h.H.NUM_INKS=0; // start empty
  for(var i=0;i<10;i++){ if(h.consoleCount()<h.H.CAP) h.spawn(); }
  eq(h.consoleCount(), 8, 'console capped at 8');
  // commit, then we can arm 8 more on top of committed history
  h.addMark(0); h.flushPending();
  eq(h.H.committedInkCount, 8);
  for(var j=0;j<8;j++){ if(h.consoleCount()<h.H.CAP) h.spawn(); }
  eq(h.consoleCount(), 8, 'another full console armed atop 8 committed');
  ok(h.H.NUM_INKS===16, 'channels grew past the old flat cap: '+h.H.NUM_INKS);
});

test('SEPARATION prints only armed channels; committed channels untouched', function(){
  var h=makeHost();
  // first run: separate into the 4 armed, then commit
  eq(h.separate(), 'ok');
  var committedLoads = h.H.loadA.slice(0,4);
  ok(committedLoads.every(function(v){return v>0;}), 'armed channels got load');
  h.flushPending();                            // lock the 4
  eq(h.H.committedInkCount, 4);
  // arm 2 new, second separate
  h.spawn(); h.spawn();
  var before = h.H.loadA.slice();
  eq(h.separate(), 'ok');
  // committed channels 0..3 unchanged; new channels 4..5 got load
  eq(h.H.loadA.slice(0,4), before.slice(0,4), 'committed channels untouched by 2nd separate');
  ok(h.H.loadA[4]>0 && h.H.loadA[5]>0, 'new armed channels printed');
});

test('separation into an empty console is a no-op (message path)', function(){
  var h=makeHost();
  h.separate(); h.flushPending();             // lock 4, console empty
  eq(h.separate(), 'empty', 'refuses with empty console');
});

console.log('\n'+passed+' passed, '+failed+' failed\n');
process.exit(failed?1:0);
