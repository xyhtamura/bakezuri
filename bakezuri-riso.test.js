var Riso = require('./bakezuri-riso.js');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function near(a, b, epsilon, message) { if (Math.abs(a - b) > epsilon) throw new Error((message || 'not near') + ': ' + a + ' vs ' + b); }

console.log('\nbakezuri riso brush geometry\n');

test('one brush stamp reveals many bounded screen ports', function () {
  var stroke = Riso.createStroke();
  var points = Riso.stamp(stroke, { width: 120, height: 80, x: 60, y: 40, reach: 20, pitch: 6, angle: 0.3, seed: 4 });
  ok(points.length > 20, 'brush did not create multiple deposit points');
  for (var i = 0; i < points.length; i++) {
    var dx = points[i].x - 60, dy = points[i].y - 40;
    ok(dx * dx + dy * dy <= 400.000001, 'port escaped brush circle');
    ok(points[i].x >= 0 && points[i].x < 120 && points[i].y >= 0 && points[i].y < 80, 'port escaped bath');
  }
});

test('overlapping stamps never deposit one screen port twice in a stroke', function () {
  var stroke = Riso.createStroke();
  var a = Riso.stamp(stroke, { width: 100, height: 80, x: 45, y: 40, reach: 18, pitch: 5, seed: 7 });
  var b = Riso.stamp(stroke, { width: 100, height: 80, x: 50, y: 40, reach: 18, pitch: 5, seed: 7 });
  var keys = a.concat(b).map(function (p) { return p.gridX + ':' + p.gridY; });
  ok(new Set(keys).size === keys.length, 'screen port repeated');
  ok(b.length > 0 && b.length < a.length, 'overlap did not reveal only new ports');
});

test('screen geometry is deterministic for pigment seed and angle', function () {
  var options = { width: 90, height: 70, x: 42, y: 31, reach: 17, pitch: 6, angle: 0.49, seed: 3 };
  var a = Riso.stamp(Riso.createStroke(), options);
  var b = Riso.stamp(Riso.createStroke(), options);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same pigment produced different screen');
});

test('path sampling reaches endpoint without gaps beyond spacing', function () {
  var points = Riso.path({ x: 2, y: 3 }, { x: 23, y: 3 }, 5);
  near(points[points.length - 1].x, 23, 1e-12, 'endpoint x');
  for (var i = 1; i < points.length; i++) ok(points[i].x - points[i - 1].x <= 5, 'path gap too wide');
});

test('full screen enumerates unique ports across rectangular bath', function () {
  var points = Riso.screen({ width: 80, height: 50, pitch: 6, angle: 0.31, seed: 2 });
  var keys = points.map(function (p) { return p.gridX + ':' + p.gridY; });
  ok(points.length > 70, 'full screen has too few ports');
  ok(new Set(keys).size === points.length, 'full screen repeated a port');
  ok(points.every(function (p) { return p.x >= 0 && p.x < 80 && p.y >= 0 && p.y < 50; }),
    'full screen escaped bath');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
