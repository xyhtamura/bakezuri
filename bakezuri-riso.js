/* Deterministic riso-screen brush geometry.
   A brush stamp reveals every screen port inside its circular footprint.
   Overlapping stamps share one claim set, so a drag deposits each port once. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakezuriRiso = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hash(a, b, seed) {
    var h = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }

  function createStroke() {
    return { claimed: Object.create(null) };
  }

  function stamp(stroke, options) {
    options = options || {};
    var width = Math.max(1, options.width | 0);
    var height = Math.max(1, options.height | 0);
    var cx = +options.x || 0, cy = +options.y || 0;
    var reach = Math.max(0, +options.reach || 0);
    var pitch = Math.max(1, +options.pitch || 1);
    var angle = +options.angle || 0, seed = +options.seed || 1;
    var ca = Math.cos(angle), sa = Math.sin(angle);
    var uc = cx * ca + cy * sa, vc = -cx * sa + cy * ca;
    var g0 = Math.floor((uc - reach) / pitch), g1 = Math.ceil((uc + reach) / pitch);
    var h0 = Math.floor((vc - reach) / pitch), h1 = Math.ceil((vc + reach) / pitch);
    var jitter = pitch * 0.13, out = [];

    for (var gu = g0; gu <= g1; gu++) {
      for (var gv = h0; gv <= h1; gv++) {
        var key = gu + ':' + gv;
        if (stroke.claimed[key]) continue;
        var u = gu * pitch + (hash(gu, gv, seed) - 0.5) * jitter;
        var v = gv * pitch + (hash(gv, gu, seed + 17) - 0.5) * jitter;
        var x = u * ca - v * sa, y = u * sa + v * ca;
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > reach * reach || x < 0 || x >= width || y < 0 || y >= height) continue;
        stroke.claimed[key] = 1;
        out.push({ x: x, y: y, gridX: gu, gridY: gv });
      }
    }
    return out;
  }

  function path(from, to, spacing) {
    if (!from) return [{ x: to.x, y: to.y }];
    var dx = to.x - from.x, dy = to.y - from.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var count = Math.max(1, Math.ceil(distance / Math.max(0.5, +spacing || 0.5)));
    var out = [];
    for (var i = 1; i <= count; i++) {
      out.push({ x: from.x + dx * i / count, y: from.y + dy * i / count });
    }
    return out;
  }

  function screen(options) {
    options = options || {};
    var width = Math.max(1, options.width | 0);
    var height = Math.max(1, options.height | 0);
    var pitch = Math.max(1, +options.pitch || 1);
    return stamp(createStroke(), {
      width: width,
      height: height,
      x: (width - 1) * 0.5,
      y: (height - 1) * 0.5,
      reach: Math.sqrt(width * width + height * height) * 0.5 + pitch,
      pitch: pitch,
      angle: +options.angle || 0,
      seed: +options.seed || 1
    });
  }

  return { createStroke: createStroke, stamp: stamp, path: path, screen: screen };
});
