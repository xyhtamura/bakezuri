var ImageMap = require('./bakezuri-image.js');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function near(a, b, epsilon, message) { if (Math.abs(a - b) > epsilon) throw new Error((message || 'not near') + ': ' + a + ' vs ' + b); }

console.log('\nbakezuri image target extraction\n');

test('dimensions preserve image aspect beneath simulation cap', function () {
  var wide = ImageMap.fitDimensions(1200, 600, 240);
  ok(wide.width === 240 && wide.height === 120, 'wide image fit changed aspect');
  var small = ImageMap.fitDimensions(40, 20, 240);
  ok(small.width === 40 && small.height === 20, 'small image was enlarged');
});

test('brightness maps dark image detail while highlights maps light', function () {
  var data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  var dark = ImageMap.extract(data, 2, 1, 'brightness');
  var light = ImageMap.extract(data, 2, 1, 'highlights');
  near(dark[0], 1, 1e-7, 'black shadow load'); near(dark[1], 0, 1e-7, 'white shadow load');
  near(light[0], 0, 1e-7, 'black highlight load'); near(light[1], 1, 1e-7, 'white highlight load');
});

test('RGB and subtractive component targets extract correct values', function () {
  var data = new Uint8ClampedArray([204, 51, 102, 255]);
  near(ImageMap.extract(data, 1, 1, 'r')[0], 0.8, 0.005, 'red');
  near(ImageMap.extract(data, 1, 1, 'g')[0], 0.2, 0.005, 'green');
  near(ImageMap.extract(data, 1, 1, 'b')[0], 0.4, 0.005, 'blue');
  near(ImageMap.extract(data, 1, 1, 'cyan')[0], 0.2, 0.005, 'cyan');
  near(ImageMap.extract(data, 1, 1, 'magenta')[0], 0.8, 0.005, 'magenta');
  near(ImageMap.extract(data, 1, 1, 'yellow')[0], 0.6, 0.005, 'yellow');
});

test('transparent image pixels behave as white paper', function () {
  var data = new Uint8ClampedArray([0, 0, 0, 0]);
  near(ImageMap.extract(data, 1, 1, 'brightness')[0], 0, 1e-7, 'transparent pixel printed shadow');
});

test('local contrast responds to an edge and not a flat field', function () {
  var flat = new Uint8ClampedArray(3 * 3 * 4), edge = new Uint8ClampedArray(3 * 3 * 4);
  for (var i = 0; i < 9; i++) {
    flat.set([128, 128, 128, 255], i * 4);
    var value = i % 3 < 2 ? 0 : 255;
    edge.set([value, value, value, 255], i * 4);
  }
  near(ImageMap.extract(flat, 3, 3, 'contrast')[4], 0, 1e-6, 'flat field has contrast');
  ok(ImageMap.extract(edge, 3, 3, 'contrast')[4] > 0.5, 'edge produced weak contrast');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
