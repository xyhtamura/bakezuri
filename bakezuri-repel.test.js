var Repel = require('./bakezuri-repel.js');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function near(a, b, epsilon, message) { if (Math.abs(a - b) > epsilon) throw new Error((message || 'not near') + ': ' + a + ' vs ' + b); }
function sum(field) { var total = 0; for (var i = 0; i < field.length; i++) total += field[i]; return total; }
function field(width, height, value) { var f = new Float32Array(width * height); f.fill(value || 0); return f; }

console.log('\nbakezuri application repel\n');

test('zero strength is exact no-op', function () {
  var W = 9, H = 9, f = field(W, H, 2), before = Array.from(f);
  Repel.apply([f], { width: W, height: H, channels: [0], cx: 4, cy: 4, radius: 3, strength: 0, scratch: new Float32Array(W * H) });
  ok(before.every(function (v, i) { return v === f[i]; }), 'field changed');
});

test('partial repel moves chosen fraction outward', function () {
  var W = 15, H = 15, f = field(W, H, 1), centre = 7 * W + 7;
  Repel.apply([f], { width: W, height: H, channels: [0], cx: 7, cy: 7, radius: 5, strength: 0.7, scratch: new Float32Array(W * H) });
  near(f[centre], 0.3, 1e-5, 'centre retains wrong fraction');
  var ringGain = 0;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var dx = x - 7, dy = y - 7, d2 = dx * dx + dy * dy;
    if (d2 >= 25 && d2 <= 64) ringGain += Math.max(0, f[y * W + x] - 1);
  }
  ok(ringGain > 5, 'outward ring did not gain load');
});

test('100% repel empties drop core into annular ring', function () {
  var W = 25, H = 25, cx = 12, cy = 12, r = 5, f = field(W, H, 1);
  Repel.apply([f], { width: W, height: H, channels: [0], cx: cx, cy: cy, radius: r, strength: 1, scratch: new Float32Array(W * H) });
  for (var y = cy - r + 1; y < cy + r; y++) for (var x = cx - r + 1; x < cx + r; x++) {
    var dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) near(f[y * W + x], 0, 1e-6, 'pigment remained in core');
  }
  var ringGain = 0;
  for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
    var ddx = xx - cx, ddy = yy - cy, d2 = ddx * ddx + ddy * ddy;
    if (d2 >= r * r && d2 <= 2 * r * r + 4) ringGain += Math.max(0, f[yy * W + xx] - 1);
  }
  ok(ringGain > 20, 'annulus did not receive displaced pigment');
});

test('mass is conserved per moved channel', function () {
  var W = 17, H = 13, a = field(W, H), b = field(W, H);
  for (var i = 0; i < a.length; i++) { a[i] = (i % 7) * 0.13; b[i] = (i % 5) * 0.21; }
  var beforeA = sum(a), beforeB = sum(b);
  Repel.apply([a, b], { width: W, height: H, channels: [0, 1], cx: 2, cy: 3, radius: 6, strength: 1, scratch: new Float32Array(W * H) });
  near(sum(a), beforeA, 2e-5, 'channel 0 mass drift');
  near(sum(b), beforeB, 2e-5, 'channel 1 mass drift');
});

test('only selected prior channels move', function () {
  var W = 11, H = 11, prior = field(W, H, 1), samePass = field(W, H, 1);
  Repel.apply([prior, samePass], { width: W, height: H, channels: [0], cx: 5, cy: 5, radius: 4, strength: 1, scratch: new Float32Array(W * H) });
  near(prior[5 * W + 5], 0, 1e-6, 'prior pigment stayed in centre');
  near(samePass[5 * W + 5], 1, 0, 'same-pass pigment moved');
});

test('edge repel remains mass-conserving and deterministic', function () {
  var W = 9, H = 9, a = field(W, H, 1), b = field(W, H, 1), before = sum(a);
  var options = { width: W, height: H, channels: [0], cx: 0, cy: 0, radius: 5, strength: 0.85 };
  options.scratch = new Float32Array(W * H); Repel.apply([a], options);
  options.scratch = new Float32Array(W * H); Repel.apply([b], options);
  near(sum(a), before, 1e-5, 'edge lost mass');
  ok(Array.from(a).every(function (v, i) { return v === b[i]; }), 'same event produced different field');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
