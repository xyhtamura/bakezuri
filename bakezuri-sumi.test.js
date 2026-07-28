var Sumi = require('./bakezuri-sumi.js');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n        ' + e.message); } }
function ok(value, message) { if (!value) throw new Error(message || 'falsy'); }
function near(a, b, epsilon, message) { if (Math.abs(a - b) > epsilon) throw new Error((message || 'not near') + ': ' + a + ' vs ' + b); }

console.log('\nbakezuri live suminagashi\n');

test('held application deposits requested flat ink', function () {
  var state = Sumi.create(41, 31), layer = Sumi.addLayer(state);
  Sumi.inject(state, 0, 20, 15, { radius: 5, amount: 3.25, interaction: 0 });
  near(Sumi.mass(layer.field), 3.25, 1e-5, 'deposit mass');
});

test('mix application creates no pressure', function () {
  var state = Sumi.create(31, 31);
  Sumi.addLayer(state);
  Sumi.inject(state, 0, 15, 15, { radius: 4, amount: 2, interaction: 0 });
  near(Sumi.motion(state), 0, 1e-12, 'mix-only application moved bath');
});

test('repel application creates outward momentum', function () {
  var state = Sumi.create(41, 41);
  Sumi.addLayer(state);
  Sumi.inject(state, 0, 20, 20, { radius: 5, amount: 3, interaction: 1 });
  ok(state.vx[20 * 41 + 27] > 0, 'right side did not move right');
  ok(state.vx[20 * 41 + 13] < 0, 'left side did not move left');
  ok(state.vy[27 * 41 + 20] > 0, 'lower side did not move down');
});

test('drop rate counts pixels per second without losing fractions', function () {
  var remainder = 0, total = 0;
  for (var frame = 0; frame < 60; frame++) {
    var due = Sumi.advanceFeed(remainder, 18, 1 / 60);
    total += due.count; remainder = due.remainder;
  }
  ok(total === 18, '18 px/s emitted ' + total + ' pixels');
  near(remainder, 0, 1e-9, 'feed remainder');
});

test('procedural source grows unique solid cells beyond axis crosshairs', function () {
  var source = Sumi.createSource(51, 51, 25, 25, 7);
  var cells = Sumi.growSource(source, 25, 25, 80);
  ok(cells.length === 80, 'wrong growth count');
  var unique = new Set(cells.map(function (p) { return p.x + ',' + p.y; }));
  ok(unique.size === 80, 'growth repeated a cell');
  ok(cells.some(function (p) { return p.x !== 25 && p.y !== 25; }), 'growth stayed on cardinal axes');
});

test('one procedural pixel is a near-solid isotropic disk plus local pressure', function () {
  var state = Sumi.create(21, 21), layer = Sumi.addLayer(state), w = 21, c = 10 * w + 10;
  Sumi.injectPixel(state, 0, 10, 10, 1);
  near(Sumi.mass(layer.field), 2.4, 1e-6, 'pixel pigment load');
  // Soft 3x3 deposit: the centre is the peak and reads as near-solid coverage,
  // but pigment spreads to all eight neighbours so a lone pixel is a disk, not
  // a cross (orthogonal and diagonal neighbours both carry ink).
  ok(1 - Math.exp(-layer.field[c] * 4.2) > 0.95, 'centre not near-solid');
  ok(layer.field[c] >= layer.field[c - 1] && layer.field[c] >= layer.field[c - w - 1],
    'centre is not the peak');
  ok(layer.field[c - 1] > 1e-6 && layer.field[c - w - 1] > 1e-6, 'deposit is a cross, not a disk');
  var nonzero = 0;
  for (var i = 0; i < layer.field.length; i++) if (layer.field[i] > 1e-6) nonzero++;
  ok(nonzero === 9, 'expected a 3x3 disk, got ' + nonzero + ' cells');
  ok(Sumi.motion(state) > 0, 'pixel made no pressure impulse');
});

test('screen dot deposits a radius-aware solid load with bounded pressure', function () {
  var state = Sumi.create(31, 31), layer = Sumi.addLayer(state);
  var placed = Sumi.injectScreenDot(state, 0, 15, 15, 2.5, 1);
  near(placed, 13.75, 1e-9, 'default screen load');
  near(Sumi.mass(layer.field), placed, 2e-5, 'screen dot mass');
  ok(layer.field[15 * 31 + 15] > 1, 'screen dot centre did not saturate');
  ok(Sumi.motion(state) > 0, 'screen dot added no pressure');
});

test('water load clears its core, preserves pigment, and adds outward motion', function () {
  var state = Sumi.create(31, 31), layer = Sumi.addLayer(state), c = 15 * 31 + 15;
  Sumi.deposit(layer.field, 31, 31, 15, 15, 7, 20);
  var before = Sumi.mass(layer.field), coreBefore = layer.field[c];
  var moved = Sumi.injectWaterPixel(state, 15, 15, 1);
  ok(moved > 0, 'water moved no pigment');
  ok(layer.field[c] < coreBefore * 0.01, 'water left pigment in its core');
  near(Sumi.mass(layer.field), before, 2e-5, 'water deleted pigment');
  ok(Sumi.motion(state) > 0, 'water added no pressure');
});

test('live advection conserves pigment mass', function () {
  var state = Sumi.create(53, 37), a = Sumi.addLayer(state), b = Sumi.addLayer(state);
  Sumi.deposit(a.field, state.width, state.height, 21, 18, 8, 20);
  Sumi.inject(state, 1, 26, 18, { radius: 5, amount: 7, interaction: 1 });
  var beforeA = Sumi.mass(a.field), beforeB = Sumi.mass(b.field);
  for (var i = 0; i < 18; i++) Sumi.step(state, { bleed: 0.04 });
  near(Sumi.mass(a.field), beforeA, 2e-4, 'old ink mass');
  near(Sumi.mass(b.field), beforeB, 2e-4, 'new ink mass');
});

test('held full repel evacuates old ink while mix leaves overlap', function () {
  function oldCore(interaction) {
    var state = Sumi.create(61, 61), old = Sumi.addLayer(state);
    Sumi.addLayer(state);
    Sumi.deposit(old.field, 61, 61, 30, 30, 18, 100);
    for (var frame = 0; frame < 24; frame++) {
      Sumi.inject(state, 1, 30, 30, { radius: 6, amount: 2, interaction: interaction });
      Sumi.step(state, { bleed: 0, drag: 0.94 });
    }
    var core = 0;
    for (var y = 0; y < 61; y++) for (var x = 0; x < 61; x++) {
      var dx = x - 30, dy = y - 30;
      if (dx * dx + dy * dy < 36) core += old.field[y * 61 + x];
    }
    near(Sumi.mass(old.field), 100, 3e-4, 'old ink mass');
    return core;
  }
  var mixedCore = oldCore(0), repelledCore = oldCore(1);
  ok(repelledCore < mixedCore * 0.1, 'repel did not clear old core: ' + mixedCore + ' -> ' + repelledCore);
});

test('an ink does not repel itself: full-repel feed stays as solid as mix feed', function () {
  // Feed one ink into the bath at a fixed point under full repel and under
  // full mix. Self-repulsion used to blow the fresh pigment apart, leaving a
  // washy halo whose centre never saturated. With per-layer self-velocity the
  // fed ink rides ~zero net velocity, so its core reaches the same coverage
  // either way. (Earlier layers, self-velocity zero, still get shoved aside.)
  function feedCore(interaction) {
    var state = Sumi.create(120, 120), layer = Sumi.addLayer(state);
    var source = Sumi.createSource(120, 120, 60, 60, 9), remainder = 0;
    for (var f = 0; f < 90; f++) {
      var due = Sumi.advanceFeed(remainder, 42, 1 / 60, 32);
      remainder = due.remainder;
      if (due.count) {
        var cells = Sumi.growSource(source, 60, 60, due.count);
        for (var ci = 0; ci < cells.length; ci++) Sumi.injectPixel(state, 0, cells[ci].x, cells[ci].y, interaction);
      }
      Sumi.step(state, { dt: 1, viscosity: 0.18, drag: 0.94, maxSpeed: 2.7, bleed: 0 });
    }
    return layer.field[60 * 120 + 60];
  }
  var mixCore = feedCore(0), repelCore = feedCore(1);
  ok(mixCore > 0.5, 'mix feed did not build a solid core: ' + mixCore);
  ok(repelCore > mixCore * 0.7, 'repel feed diluted its own core: ' + mixCore + ' -> ' + repelCore);
});

test('self-attraction makes an ink resist bleed while conserving its mass', function () {
  // Two identical blobs, same strong bleed. The cohesive ink (selfAttract 1)
  // must keep a far higher peak (holds its edge) than the free ink, and both
  // must still conserve pigment mass exactly.
  function peakAfterBleed(selfAttract) {
    var state = Sumi.create(41, 41), layer = Sumi.addLayer(state), c = 20 * 41 + 20;
    Sumi.deposit(layer.field, 41, 41, 20, 20, 5, 12);
    Sumi.setSelfAttract(layer, selfAttract);
    var before = Sumi.mass(layer.field);
    for (var i = 0; i < 40; i++) Sumi.step(state, { bleed: 0.2, drag: 0.94 });
    near(Sumi.mass(layer.field), before, 3e-4, 'self-attract ' + selfAttract + ' changed mass');
    return layer.field[c];
  }
  var free = peakAfterBleed(0), cohesive = peakAfterBleed(1);
  ok(cohesive > free * 1.5, 'cohesive ink did not hold its peak: free ' + free + ' vs cohesive ' + cohesive);
});

test('high self-attraction creates conservative anti-diffusion sharpening without negative loads', function () {
  var state = Sumi.create(41, 41), layer = Sumi.addLayer(state);
  Sumi.deposit(layer.field, 41, 41, 20, 20, 6, 15);
  Sumi.setSelfAttract(layer, 1.0);
  var initialMass = Sumi.mass(layer.field);
  
  // First step with zero bath bleed to let anti-diffusion gather edge ink back to center
  for (var k = 0; k < 20; k++) {
    Sumi.step(state, { bleed: 0.0, drag: 0.94 });
  }

  near(Sumi.mass(layer.field), initialMass, 1e-5, 'mass leaked during anti-diffusion');
  for (var i = 0; i < layer.field.length; i++) {
    ok(layer.field[i] >= 0, 'negative cell load at index ' + i + ': ' + layer.field[i]);
  }
});

test('setSelfAttract clamps to 0..1', function () {
  var state = Sumi.create(5, 5), layer = Sumi.addLayer(state);
  ok(Sumi.setSelfAttract(layer, 5) === 1 && Sumi.setSelfAttract(layer, -3) === 0, 'not clamped');
});

test('pairwise repel matrix controls momentum transfer between distinct layers', function () {
  // Layer 0 is existing ink. Layer 1 applies repeated pressure pulses.
  // When repelMatrix[0][1] = 0, layer 0 ignores layer 1's push.
  // When repelMatrix[0][1] = 1, layer 0 is displaced by layer 1's push.
  function displaceOldCore(repelCoeff) {
    var state = Sumi.create(61, 61);
    var oldLayer = Sumi.addLayer(state);
    var newLayer = Sumi.addLayer(state);
    Sumi.deposit(oldLayer.field, 61, 61, 30, 30, 18, 100);
    
    var matrix = [
      [0, repelCoeff], // Layer 0 feels repelCoeff from layer 1
      [repelCoeff, 0]  // Layer 1 feels repelCoeff from layer 0
    ];

    for (var frame = 0; frame < 24; frame++) {
      Sumi.inject(state, 1, 30, 30, { radius: 6, amount: 2, interaction: 1.0 });
      Sumi.step(state, { dt: 1, viscosity: 0.18, drag: 0.94, maxSpeed: 2.8, bleed: 0, repelMatrix: matrix });
    }

    var core = 0;
    for (var y = 0; y < 61; y++) for (var x = 0; x < 61; x++) {
      var dx = x - 30, dy = y - 30;
      if (dx * dx + dy * dy < 36) core += oldLayer.field[y * 61 + x];
    }
    return core;
  }
  
  var zeroRepelCore = displaceOldCore(0.0);
  var fullRepelCore = displaceOldCore(1.0);
  ok(fullRepelCore < zeroRepelCore * 0.15, 'full repel did not evacuate core compared to zero repel: zero ' + zeroRepelCore + ' vs full ' + fullRepelCore);
});

test('released bath retains momentum then settles', function () {
  var state = Sumi.create(35, 35);
  Sumi.addLayer(state);
  Sumi.inject(state, 0, 17, 17, { radius: 5, amount: 3, interaction: 1 });
  Sumi.step(state, { drag: 0.9 });
  var early = Sumi.motion(state);
  for (var i = 0; i < 100; i++) Sumi.step(state, { drag: 0.9 });
  var late = Sumi.motion(state);
  ok(early > 0, 'no retained momentum');
  ok(late < early * 0.05, 'bath failed to settle: ' + early + ' -> ' + late);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
