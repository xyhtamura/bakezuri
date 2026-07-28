var fs = require('fs');
var html = fs.readFileSync(__dirname + '/suminagashi.html', 'utf8');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); }
}
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function section(from, to) {
  var start = html.indexOf(from), end = html.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error('missing section ' + from);
  return html.slice(start, end);
}

console.log('\nbakezuri 3 load UI\n');

test('animation update leaves swatch buttons mounted so click can complete', function () {
  var update = section('function updateUI(motion)', 'function pointFromEvent');
  ok(update.indexOf('innerHTML') < 0, 'updateUI rebuilds swatches during animation');
  ok(section('function renderLoads()', 'function updateUI').indexOf('innerHTML') >= 0,
    'load-change renderer no longer builds swatches');
});

test('swatch click reloads selected pigment through delegated stable handler', function () {
  var handlers = section("colour.addEventListener('input'", 'function frame');
  ok(handlers.indexOf("closest('[data-ink]')") >= 0, 'missing swatch target lookup');
  ok(handlers.indexOf('selectInk(+swatch.dataset.ink)') >= 0, 'swatch does not select its pigment');
});

test('each ink press creates a physical film alias of selected pigment', function () {
  var feed = section('function feed(dt)', '// Pigment-level mix law');
  ok(feed.indexOf('Sumi.addLayer(state)') >= 0 && feed.indexOf('films.push({pigment:current,layer})') >= 0,
    'feed reuses pigment identity instead of a fresh physical layer');
  ok(feed.indexOf('Sumi.setSelfAttract(layer') >= 0,
    'fresh film does not inherit its pigment self-attraction');
  ok(feed.indexOf('Sumi.injectPixel(state,activeFilm') >= 0,
    'feed does not inject into fresh physical alias');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
