var fs = require('fs');
var html = fs.readFileSync(__dirname + '/riso-live.html', 'utf8');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function section(from, to) {
  var start = html.indexOf(from), end = html.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error('missing section ' + from);
  return html.slice(start, end);
}

console.log('\nbakezuri 2-02 checkpoint integration\n');

test('uses live bath, smooth separated resolver, and riso geometry modules', function () {
  ok(html.indexOf('bakezuri-core.js') >= 0 || html.indexOf('<script src="bakezuri-sumi.js"></script>') >= 0, 'missing live bath engine');
  ok(html.indexOf('bakezuri-core.js') >= 0 || html.indexOf('<script src="bakezuri-riso.js"></script>') >= 0, 'missing riso brush geometry');
  ok(html.indexOf('Basic.resolveSeparatedHi(') >= 0, 'missing smooth separated resolver');
});

test('brush stamp injects many screen dots into one loaded film', function () {
  var stamp = section('function screenStamp(point)', 'function drawTo(point)');
  ok(stamp.indexOf('Riso.stamp(stroke') >= 0, 'brush does not generate screen ports');
  ok(stamp.indexOf('ensureLoadedFilm()') >= 0, 'screen has no loaded film');
  ok(stamp.indexOf('Sumi.injectScreenDot') >= 0, 'ports do not enter live bath');
});

test('switching pigment invalidates film alias and stable swatches remain clickable', function () {
  var select = section('function selectInk(index)', 'function selectWater()');
  ok(select.indexOf('loadedFilm=null') >= 0, 'pigment reload reuses old physical film');
  var update = section('function updateUI(motion)', 'function pointFromEvent');
  ok(update.indexOf('innerHTML') < 0, 'animation rebuilds swatch buttons');
  ok(html.indexOf("closest('[data-pigment]')") >= 0, 'missing swatch click handler');
});

test('water follows same riso screen and adds no pigment film', function () {
  var stamp = section('function screenStamp(point)', 'function drawTo(point)');
  ok(stamp.indexOf("loadType==='water'") >= 0, 'stamp has no water route');
  ok(stamp.indexOf('Sumi.injectWaterPixel') >= 0, 'water does not repel bath pigment');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
