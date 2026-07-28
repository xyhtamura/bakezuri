/* One-shot ink-application repel. Earlier pigment inside a new drop is
   displaced radially; no force persists after application. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakezuriRepel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function centreAngle(cx, cy, channel) {
    var h = Math.sin((cx + 1) * 127.1 + (cy + 1) * 311.7 + (channel + 1) * 74.7) * 43758.5453;
    return (h - Math.floor(h)) * Math.PI * 2;
  }

  function scatter(delta, width, height, x, y, amount) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    x0 = clamp(x0, 0, width - 1); x1 = clamp(x1, 0, width - 1);
    y0 = clamp(y0, 0, height - 1); y1 = clamp(y1, 0, height - 1);
    delta[y0 * width + x0] += amount * (1 - fx) * (1 - fy);
    delta[y0 * width + x1] += amount * fx * (1 - fy);
    delta[y1 * width + x0] += amount * (1 - fx) * fy;
    delta[y1 * width + x1] += amount * fx * fy;
  }

  function apply(fields, options) {
    options = options || {};
    var width = options.width | 0, height = options.height | 0;
    var cx = +options.cx, cy = +options.cy;
    var radius = Math.max(1, +options.radius || 1);
    var strength = clamp(+options.strength || 0, 0, 1);
    var channels = options.channels || [];
    var scratch = options.scratch;
    if (!width || !height || !scratch || scratch.length !== width * height || strength <= 0 || !channels.length) {
      return { moved: 0, bounds: null };
    }

    var reach = Math.ceil(radius * Math.SQRT2 + 2);
    var x0 = Math.max(0, Math.floor(cx - reach));
    var y0 = Math.max(0, Math.floor(cy - reach));
    var x1 = Math.min(width - 1, Math.ceil(cx + reach));
    var y1 = Math.min(height - 1, Math.ceil(cy + reach));
    var sx0 = Math.max(0, Math.floor(cx - radius));
    var sy0 = Math.max(0, Math.floor(cy - radius));
    var sx1 = Math.min(width - 1, Math.ceil(cx + radius));
    var sy1 = Math.min(height - 1, Math.ceil(cy + radius));
    var radius2 = radius * radius;
    var movedTotal = 0;

    for (var ci = 0; ci < channels.length; ci++) {
      var channel = channels[ci] | 0;
      var field = fields[channel];
      if (!field || field.length !== width * height) continue;
      for (var yy = y0; yy <= y1; yy++) {
        for (var xx = x0; xx <= x1; xx++) scratch[yy * width + xx] = 0;
      }

      for (var y = sy0; y <= sy1; y++) {
        for (var x = sx0; x <= sx1; x++) {
          var dx = x - cx, dy = y - cy;
          var d2 = dx * dx + dy * dy;
          if (d2 >= radius2) continue;
          var i = y * width + x, value = field[i];
          if (value <= 0) continue;
          var d = Math.sqrt(d2);
          var moved = value * strength;
          if (moved <= 1e-12) continue;

          var ux, uy;
          if (d > 1e-6) { ux = dx / d; uy = dy / d; }
          else {
            var angle = centreAngle(cx, cy, channel);
            ux = Math.cos(angle); uy = Math.sin(angle);
          }

          // Jaffer-style drop map: a disk of area pi*r^2 becomes an annulus.
          // At 100%, every prior-pigment cell under the drop leaves the core.
          // Extra sub-cell margin keeps bilinear scatter from leaking back into
          // the vacated core at full strength.
          var targetDistance = Math.sqrt(d2 + strength * radius2) + Math.SQRT2 * strength;
          var tx = cx + ux * targetDistance;
          var ty = cy + uy * targetDistance;
          scratch[i] -= moved;
          scatter(scratch, width, height, tx, ty, moved);
          movedTotal += moved;
        }
      }

      for (var ay = y0; ay <= y1; ay++) {
        for (var ax = x0; ax <= x1; ax++) {
          var ai = ay * width + ax;
          field[ai] += scratch[ai];
          if (field[ai] < 0 && field[ai] > -1e-6) field[ai] = 0;
        }
      }
    }
    return { moved: movedTotal, bounds: [x0, y0, x1, y1] };
  }

  return { apply: apply };
});
