var Basic = require('./bakezuri-basic.js');
var Repel = require('./bakezuri-repel.js');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function near(a, b, epsilon, message) { if (Math.abs(a - b) > epsilon) throw new Error((message || 'not near') + ': ' + a + ' vs ' + b); }

console.log('\nbakezuri basic mechanics\n');

test('deposit conserves requested ink amount', function () {
  var W = 21, H = 17, f = new Float32Array(W * H);
  Basic.deposit(f, W, H, 2, 3, 7, 4.25);
  near(Basic.mass(f), 4.25, 1e-5, 'deposit mass');
});

test('bleed conserves ink mass', function () {
  var W = 18, H = 14, a = new Float32Array(W * H), b = new Float32Array(W * H);
  Basic.deposit(a, W, H, 1, 1, 5, 9);
  var before = Basic.mass(a);
  Basic.diffuse(a, b, W, H, 0.2);
  near(Basic.mass(b), before, 2e-5, 'diffusion mass');
});

test('dense single flat ink resolves near literal chosen colour', function () {
  var f = new Float32Array([8]), out = new Uint8ClampedArray(4);
  Basic.resolve([f], [[1, 0.1, 0.2]], [0.95, 0.96, 0.91], out);
  ok(out[0] > 245 && out[1] < 35 && out[2] < 60, 'flat ink became dark or shifted: ' + Array.from(out));
});

test('overlapping flat inks mix by load instead of multiplying to black', function () {
  var a = new Float32Array([4]), b = new Float32Array([4]), out = new Uint8ClampedArray(4);
  Basic.resolve([a, b], [[1, 0, 0], [0, 0, 1]], [1, 1, 1], out);
  ok(out[0] > 170 && out[2] > 170 && out[1] < 25, 'red + blue did not make bright mixed violet: ' + Array.from(out));
});

test('separated resolver gives overlapping water films to one ink, never a colour mix', function () {
  var red = new Float32Array([4]), blue = new Float32Array([4]), out = new Uint8ClampedArray(4);
  Basic.resolveSeparated([red, blue], [[1, 0, 0], [0, 0, 1]], [1, 1, 1], out);
  ok(out[0] < 25 && out[1] < 25 && out[2] > 245,
    'equal overlap did not belong to later blue ink: ' + Array.from(out));
});

test('screened new ink can vacate old ink, occupy core, and leave old ring', function () {
  var W = 25, H = 25, cx = 12, cy = 12, r = 5;
  var oldInk = new Float32Array(W * H), newInk = new Float32Array(W * H), scratch = new Float32Array(W * H);
  oldInk.fill(1);
  Repel.apply([oldInk, newInk], { width: W, height: H, channels: [0], cx: cx, cy: cy, radius: r, strength: 1, scratch: scratch });
  Basic.deposit(newInk, W, H, cx, cy, r, 20);
  near(oldInk[cy * W + cx], 0, 1e-6, 'old ink remained under new ink');
  ok(newInk[cy * W + cx] > 0, 'new ink did not occupy vacated core');
  var ringGain = 0;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 >= r * r && d2 <= 2 * r * r + 8) ringGain += Math.max(0, oldInk[y * W + x] - 1);
  }
  ok(ringGain > 20, 'old ink did not form surrounding ring');
});

test('hi-res resolve ramps ink-vs-paper coverage smoothly across a cell edge', function () {
  // 2x1 field: one full ink cell beside empty paper. Upsample wide and read the
  // green channel of a red ink (paper white): coverage must ramp monotonically,
  // and a mid-boundary pixel must sit strictly between pure ink and pure paper
  // rather than jumping cell to cell.
  var field = new Float32Array([6, 0]);
  var outW = 16, out = new Uint8ClampedArray(outW * 4);
  Basic.resolveSeparatedHi([field], [[1, 0, 0]], [1, 1, 1], out, outW, 1, 2, 1, 4.2, 0.35);
  var g = [];
  for (var i = 0; i < outW; i++) g.push(out[i * 4 + 1]);
  ok(g[0] < 30, 'ink end not saturated: ' + g[0]);
  ok(g[outW - 1] > 225, 'paper end not clear: ' + g[outW - 1]);
  for (var j = 1; j < outW; j++) ok(g[j] >= g[j - 1] - 1, 'coverage not monotonic at ' + j);
  // Anti-aliasing means the boundary spreads over several pixels: no single
  // pixel makes the whole ink->paper jump the way a raw cell edge would.
  var maxJump = 0;
  for (var m = 1; m < outW; m++) maxJump = Math.max(maxJump, Math.abs(g[m] - g[m - 1]));
  ok(maxJump < 200, 'boundary is a hard step, not an anti-aliased ramp: ' + g.join(','));
});

test('hi-res resolve keeps inks pure but blends a thin anti-aliased seam', function () {
  // Two abutting inks, equal load: interiors stay pure, the straddling pixel on
  // the equal-load curve is a ~50/50 blend of both (anti-aliasing, not mixing).
  var red = new Float32Array([6, 6, 0, 0]);
  var blue = new Float32Array([0, 0, 6, 6]);
  var outW = 4, out = new Uint8ClampedArray(outW * 4);
  Basic.resolveSeparatedHi([red, blue], [[1, 0, 0], [0, 0, 1]], [1, 1, 1], out, outW, 1, 4, 1, 4.2, 0.35);
  ok(out[0] > 200 && out[2] < 40, 'left interior not pure red: ' + [out[0], out[1], out[2]]);
  ok(out[12] < 40 && out[14] > 200, 'right interior not pure blue: ' + [out[12], out[13], out[14]]);
  var seam = new Float32Array([3, 3, 0]);   // straddle: red just above blue -> tie band
  var seamRed = new Float32Array([3]), seamBlue = new Float32Array([3]), so = new Uint8ClampedArray(4);
  Basic.resolveSeparatedHi([seamRed, seamBlue], [[1, 0, 0], [0, 0, 1]], [1, 1, 1], so, 1, 1, 1, 1, 4.2, 0.35);
  ok(so[0] > 120 && so[2] > 120, 'equal-load seam pixel is not a red/blue blend: ' + [so[0], so[1], so[2]]);
});

test('mix law: default keeps overlapping inks separate, coefficient blends them', function () {
  // Red field sits above blue everywhere (red owns the cells), but blue is
  // present too (overlap ratio 0.5). Default render = pure red. A mix
  // coefficient bleeds blue into the shared band; more coefficient = more blue.
  var red = new Float32Array([4, 4]), blue = new Float32Array([2, 2]);
  var cols = [[1, 0, 0], [0, 0, 1]], paper = [1, 1, 1];
  function blueAt(mix) {
    var out = new Uint8ClampedArray(2 * 4);
    var mm = mix == null ? null : [[0, mix], [mix, 0]];
    Basic.resolveSeparatedHi([red, blue], cols, paper, out, 2, 1, 2, 1, 4.2, 0.35, mm);
    return out[2]; // blue channel of the (red-owned) pixel
  }
  ok(blueAt(null) < 30, 'default overlap was not pure red: ' + blueAt(null));
  ok(blueAt(0) < 30, 'mix 0 was not pure red: ' + blueAt(0));
  ok(blueAt(1) > blueAt(0.4) && blueAt(0.4) > blueAt(0), 'blend did not grow with coefficient');
  ok(blueAt(1) > 70, 'full mix produced no blue tint: ' + blueAt(1));
});

test('mix law: blend grows as overlap grows (the bloom-over-bleed behaviour)', function () {
  // Same coefficient, two overlap ratios. More overlap (runner closer to
  // winner, as bleed produces over time) => more of the runner's colour shows.
  var cols = [[1, 0, 0], [0, 0, 1]], paper = [1, 1, 1], mm = [[0, 1], [1, 0]];
  function blueForOverlap(blueLoad) {
    var red = new Float32Array([4]), blue = new Float32Array([blueLoad]);
    var out = new Uint8ClampedArray(4);
    Basic.resolveSeparatedHi([red, blue], cols, paper, out, 1, 1, 1, 1, 4.2, 0.35, mm);
    return out[2];
  }
  ok(blueForOverlap(3.6) > blueForOverlap(1.2), 'wider overlap did not show more mixed colour');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
