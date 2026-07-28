var fs = require('fs');
var html = fs.readFileSync(__dirname + '/riso.html', 'utf8');
var ImageMap = require('./bakezuri-image.js');
var Riso = require('./bakezuri-riso.js');
var Sumi = require('./bakezuri-sumi.js');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function section(from, to) {
  var start = html.indexOf(from), end = html.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error('missing section ' + from);
  return html.slice(start, end);
}

console.log('\nbakezuri 2 image-riso spine\n');

test('loads image target, live bath, and riso modules', function () {
  ok(html.indexOf('bakezuri-core.js') >= 0 || html.indexOf('<script src="bakezuri-image.js"></script>') >= 0, 'missing image target module');
  ok(html.indexOf('bakezuri-core.js') >= 0 || html.indexOf('<script src="bakezuri-sumi.js"></script>') >= 0, 'missing live bath engine');
  ok(html.indexOf('bakezuri-core.js') >= 0 || html.indexOf('<script src="bakezuri-riso.js"></script>') >= 0, 'missing riso geometry');
});

test('image upload resets bath to fitted source dimensions', function () {
  var load = section('function loadImageFile(file)', 'function runRiso()');
  ok(load.indexOf('ImageMap.fitDimensions') >= 0, 'image dimensions not fitted');
  ok(load.indexOf('allocate(dims.width,dims.height)') >= 0, 'new image does not start fresh bath');
  ok(load.indexOf('sourceCtx.getImageData') >= 0, 'source pixels not captured');
});

test('one run extracts one target and creates exactly one fresh film', function () {
  var run = section('function runRiso()', 'function render()');
  ok(run.indexOf('ImageMap.extract(sourceData,W,H,pigment.target)') >= 0, 'run ignores selected target');
  ok(run.indexOf('Riso.screen(') >= 0, 'run does not create full riso screen');
  ok(run.indexOf('films.push({pigment:current') >= 0, 'run does not create fresh film alias');
  ok(run.indexOf('Sumi.injectScreenDot') >= 0, 'run does not deposit into live bath');
});

test('dot pitch and dot size independently control halftone geometry', function () {
  var run = section('function runRiso()', 'function render()');
  ok(run.indexOf('pitchCtl.value') >= 0, 'pitch unused');
  ok(run.indexOf('dotSizeCtl.value') >= 0, 'dot size unused');
  ok(run.indexOf('Math.sqrt(value)*pitch*.5*size') >= 0, 'image target does not size dots');
});

test('pigment swatches stay mounted during animation and can be reused', function () {
  var update = section('function updateUI(motion)', 'function loadImageFile(file)');
  ok(update.indexOf('innerHTML') < 0, 'animation rebuilds pigment buttons');
  ok(html.indexOf("closest('[data-pigment]')") >= 0, 'missing pigment click handler');
});

test('synthetic image target becomes one pressured wet riso film', function () {
  var width = 48, height = 32, data = new Uint8ClampedArray(width * height * 4);
  for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
    var value = x < width / 2 ? 0 : 255, o = (y * width + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = value; data[o + 3] = 255;
  }
  var target = ImageMap.extract(data, width, height, 'brightness');
  var ports = Riso.screen({ width: width, height: height, pitch: 5, angle: 0.2, seed: 1 });
  var state = Sumi.create(width, height), layer = Sumi.addLayer(state), printed = 0;
  for (var i = 0; i < ports.length; i++) {
    var px = Math.max(0, Math.min(width - 1, Math.round(ports[i].x)));
    var py = Math.max(0, Math.min(height - 1, Math.round(ports[i].y)));
    var load = target[py * width + px];
    if (load <= 0.012) continue;
    Sumi.injectScreenDot(state, 0, ports[i].x, ports[i].y, Math.max(0.6, Math.sqrt(load) * 2.25), 1);
    printed++;
  }
  ok(printed > 10, 'image produced too few dots');
  ok(Sumi.mass(layer.field) > 0, 'riso film has no pigment');
  ok(Sumi.motion(state) > 0, 'riso film added no bath pressure');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
