/* Test suite for bakezuri-core.js unified module and host glue */
const assert = require('assert');
const test = require('node:test');
const BakezuriCore = require('./bakezuri-core.js');

test('bakezuri-core re-exports core primitives', (t) => {
  assert.ok(BakezuriCore.Basic, 'Basic module exported');
  assert.ok(BakezuriCore.Sumi, 'Sumi module exported');
  assert.ok(BakezuriCore.Chain, 'Chain module exported');
  assert.ok(BakezuriCore.Riso, 'Riso module exported');
  assert.ok(BakezuriCore.Image, 'Image module exported');
  assert.ok(BakezuriCore.Repel, 'Repel module exported');
  assert.ok(BakezuriCore.Host, 'Host module exported');
});

test('bakezuri-core Host.allocateBath creates state and dimension parameters', (t) => {
  const bath = BakezuriCore.Host.allocateBath({ width: 300, height: 200, superScale: 2 });
  assert.strictEqual(bath.sw, 300);
  assert.strictEqual(bath.sh, 200);
  assert.strictEqual(bath.superScale, 2);
  assert.strictEqual(bath.rw, 600);
  assert.strictEqual(bath.rh, 400);
  assert.ok(bath.state, 'Sumi state created');
  assert.strictEqual(bath.state.width, 300);
  assert.strictEqual(bath.state.height, 200);
});

test('bakezuri-core Host.createFilm allocates a film layer with properties', (t) => {
  const bath = BakezuriCore.Host.allocateBath({ width: 100, height: 100 });
  const film = BakezuriCore.Host.createFilm(bath.state, 0, '#bb3854', null, 0.4);

  assert.strictEqual(film.pigment, 0);
  assert.strictEqual(film.hex, '#bb3854');
  assert.ok(Array.isArray(film.colour));
  assert.strictEqual(film.layer.selfAttract, 0.4);
  assert.strictEqual(bath.state.layers.length, 1);
});
