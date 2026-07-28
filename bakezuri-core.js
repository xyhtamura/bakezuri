/* ════════════════════════════════════════════════════════════════════════
   bakezuri-core.js  —  frozen engine core & host glue

   Unified UMD core module for Bakezuri instruments. Standalone and self-contained.
   Bundles and re-exports:
     - Basic   (BakezuriBasic)  : conserved flat-ink deposition, diffusion, and resolvers
     - Sumi    (BakezuriSumi)   : live suminagashi field engine, damped velocity, self-attraction
     - Chain   (BakezuriChain)  : process-chain state machine reducer
     - Riso    (BakezuriRiso)   : riso screen brush geometry
     - Image   (BakezuriImage)  : image-to-ink target extraction
     - Repel   (BakezuriRepel)  : one-shot application repel

   Exposes host glue (`BakezuriCore.Host`) for bath allocation, rendering pipeline,
   and film lifecycle management.
   ════════════════════════════════════════════════════════════════════════ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BakezuriCore = factory();
    if (!root.BakezuriBasic) root.BakezuriBasic = root.BakezuriCore.Basic;
    if (!root.BakezuriSumi) root.BakezuriSumi = root.BakezuriCore.Sumi;
    if (!root.BakezuriChain) root.BakezuriChain = root.BakezuriCore.Chain;
    if (!root.BakezuriRiso) root.BakezuriRiso = root.BakezuriCore.Riso;
    if (!root.BakezuriImage) root.BakezuriImage = root.BakezuriCore.Image;
    if (!root.BakezuriRepel) root.BakezuriRepel = root.BakezuriCore.Repel;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 1. BakezuriBasic ───────────────────────────────────────────────────
  var Basic = (function () {
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    function hexToRgb(hex) {
      return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255
      ];
    }

    function srgbToLinear(v) {
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    function linearToSrgb(v) {
      v = clamp01(v);
      return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    }

    function deposit(field, width, height, cx, cy, radius, amount) {
      radius = Math.max(1, radius);
      var x0 = Math.max(0, Math.floor(cx - radius));
      var y0 = Math.max(0, Math.floor(cy - radius));
      var x1 = Math.min(width - 1, Math.ceil(cx + radius));
      var y1 = Math.min(height - 1, Math.ceil(cy + radius));
      var cells = [], weightSum = 0;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var dx = x - cx, dy = y - cy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d >= radius) continue;
          var w = 1 - d / radius;
          w *= w;
          cells.push([y * width + x, w]);
          weightSum += w;
        }
      }
      if (weightSum <= 0) return 0;
      for (var i = 0; i < cells.length; i++) field[cells[i][0]] += amount * cells[i][1] / weightSum;
      return amount;
    }

    function diffuse(src, dst, width, height, rate) {
      rate = Math.max(0, Math.min(0.24, rate));
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var i = y * width + x, c = src[i];
          var l = x > 0 ? src[i - 1] : c;
          var r = x < width - 1 ? src[i + 1] : c;
          var u = y > 0 ? src[i - width] : c;
          var d = y < height - 1 ? src[i + width] : c;
          var next = c + rate * (l + r + u + d - 4 * c);
          dst[i] = next > 0 ? next : 0;
        }
      }
    }

    function resolve(fields, colours, paper, out, density) {
      density = density == null ? 1.35 : density;
      var cells = fields.length ? fields[0].length : out.length / 4;
      var paperLinear = [srgbToLinear(paper[0]), srgbToLinear(paper[1]), srgbToLinear(paper[2])];
      var colourLinear = colours.map(function (c) {
        return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
      });
      for (var i = 0; i < cells; i++) {
        var total = 0, r = 0, g = 0, b = 0;
        for (var k = 0; k < fields.length; k++) {
          var load = fields[k][i];
          if (load <= 1e-8) continue;
          total += load;
          r += colourLinear[k][0] * load;
          g += colourLinear[k][1] * load;
          b += colourLinear[k][2] * load;
        }
        var o = i * 4;
        if (total <= 1e-8) {
          out[o] = Math.round(paper[0] * 255);
          out[o + 1] = Math.round(paper[1] * 255);
          out[o + 2] = Math.round(paper[2] * 255);
          out[o + 3] = 255;
          continue;
        }
        var coverage = 1 - Math.exp(-total * density);
        r = paperLinear[0] * (1 - coverage) + (r / total) * coverage;
        g = paperLinear[1] * (1 - coverage) + (g / total) * coverage;
        b = paperLinear[2] * (1 - coverage) + (b / total) * coverage;
        out[o] = Math.round(linearToSrgb(r) * 255);
        out[o + 1] = Math.round(linearToSrgb(g) * 255);
        out[o + 2] = Math.round(linearToSrgb(b) * 255);
        out[o + 3] = 255;
      }
    }

    function resolveSeparated(fields, colours, paper, out, density) {
      density = density == null ? 1.35 : density;
      var cells = fields.length ? fields[0].length : out.length / 4;
      var paperLinear = [srgbToLinear(paper[0]), srgbToLinear(paper[1]), srgbToLinear(paper[2])];
      var colourLinear = colours.map(function (c) {
        return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
      });
      for (var i = 0; i < cells; i++) {
        var owner = -1, load = 0;
        for (var k = 0; k < fields.length; k++) {
          if (fields[k][i] >= load && fields[k][i] > 1e-8) {
            owner = k;
            load = fields[k][i];
          }
        }
        var o = i * 4;
        if (owner < 0) {
          out[o] = Math.round(paper[0] * 255);
          out[o + 1] = Math.round(paper[1] * 255);
          out[o + 2] = Math.round(paper[2] * 255);
          out[o + 3] = 255;
          continue;
        }
        var coverage = 1 - Math.exp(-load * density);
        out[o] = Math.round(linearToSrgb(paperLinear[0] * (1 - coverage) + colourLinear[owner][0] * coverage) * 255);
        out[o + 1] = Math.round(linearToSrgb(paperLinear[1] * (1 - coverage) + colourLinear[owner][1] * coverage) * 255);
        out[o + 2] = Math.round(linearToSrgb(paperLinear[2] * (1 - coverage) + colourLinear[owner][2] * coverage) * 255);
        out[o + 3] = 255;
      }
    }

    function sampleBilinear(field, width, height, x, y) {
      if (x < 0) x = 0; else if (x > width - 1) x = width - 1;
      if (y < 0) y = 0; else if (y > height - 1) y = height - 1;
      var x0 = x | 0, y0 = y | 0;
      var x1 = x0 + 1 < width ? x0 + 1 : x0;
      var y1 = y0 + 1 < height ? y0 + 1 : y0;
      var tx = x - x0, ty = y - y0;
      var a = field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx;
      var b = field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx;
      return a * (1 - ty) + b * ty;
    }

    function resolveSeparatedHi(fields, colours, paper, out, outW, outH, srcW, srcH, density, seam, mixMatrix) {
      density = density == null ? 1.35 : density;
      seam = seam == null ? 0.35 : seam;
      var nf = fields.length;
      var paperLinear = [srgbToLinear(paper[0]), srgbToLinear(paper[1]), srgbToLinear(paper[2])];
      var colourLinear = colours.map(function (c) {
        return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
      });
      var sx = srcW / outW, sy = srcH / outH;
      for (var oy = 0; oy < outH; oy++) {
        var fy = (oy + 0.5) * sy - 0.5;
        for (var ox = 0; ox < outW; ox++) {
          var fx = (ox + 0.5) * sx - 0.5;
          var lw = 0, lr = 0, wi = -1, ri = -1;
          for (var k = 0; k < nf; k++) {
            var load = sampleBilinear(fields[k], srcW, srcH, fx, fy);
            if (load >= lw) { lr = lw; ri = wi; lw = load; wi = k; }
            else if (load >= lr) { lr = load; ri = k; }
          }
          var o = (oy * outW + ox) * 4;
          if (wi < 0 || lw <= 1e-6) {
            out[o] = Math.round(paper[0] * 255);
            out[o + 1] = Math.round(paper[1] * 255);
            out[o + 2] = Math.round(paper[2] * 255);
            out[o + 3] = 255;
            continue;
          }
          var coverage = 1 - Math.exp(-lw * density);
          var ir = colourLinear[wi][0], ig = colourLinear[wi][1], ib = colourLinear[wi][2];
          if (ri >= 0 && lr > 1e-6) {
            var d = (lw - lr) / seam;
            var frAA = d >= 1 ? 0 : 0.5 * (1 - d);
            var frMix = 0;
            if (mixMatrix && mixMatrix[wi]) {
              var m = mixMatrix[wi][ri] || 0;
              if (m > 0) frMix = 0.5 * m * (lr / lw);
            }
            var fr = frAA > frMix ? frAA : frMix;
            if (fr > 0.5) fr = 0.5;
            var fw = 1 - fr;
            ir = ir * fw + colourLinear[ri][0] * fr;
            ig = ig * fw + colourLinear[ri][1] * fr;
            ib = ib * fw + colourLinear[ri][2] * fr;
          }
          out[o] = Math.round(linearToSrgb(paperLinear[0] * (1 - coverage) + ir * coverage) * 255);
          out[o + 1] = Math.round(linearToSrgb(paperLinear[1] * (1 - coverage) + ig * coverage) * 255);
          out[o + 2] = Math.round(linearToSrgb(paperLinear[2] * (1 - coverage) + ib * coverage) * 255);
          out[o + 3] = 255;
        }
      }
    }

    function mass(field) {
      var total = 0;
      for (var i = 0; i < field.length; i++) total += field[i];
      return total;
    }

    return {
      hexToRgb: hexToRgb,
      deposit: deposit,
      diffuse: diffuse,
      resolve: resolve,
      resolveSeparated: resolveSeparated,
      resolveSeparatedHi: resolveSeparatedHi,
      sampleBilinear: sampleBilinear,
      mass: mass
    };
  })();

  // ── 2. BakezuriSumi ────────────────────────────────────────────────────
  var Sumi = (function () {
    function clamp(value, low, high) {
      return value < low ? low : (value > high ? high : value);
    }

    function create(width, height) {
      var size = width * height;
      return {
        width: width,
        height: height,
        layers: [],
        vx: new Float32Array(size),
        vy: new Float32Array(size),
        vxWork: new Float32Array(size),
        vyWork: new Float32Array(size),
        vxNext: new Float32Array(size),
        vyNext: new Float32Array(size)
      };
    }

    function addLayer(state) {
      var size = state.width * state.height;
      var layer = {
        field: new Float32Array(size),
        next: new Float32Array(size),
        svx: new Float32Array(size),
        svy: new Float32Array(size),
        svxWork: new Float32Array(size),
        svyWork: new Float32Array(size),
        selfAttract: 0
      };
      state.layers.push(layer);
      return layer;
    }

    function deposit(field, width, height, cx, cy, radius, amount) {
      radius = Math.max(0.75, radius);
      if (amount <= 0) return 0;
      var x0 = Math.max(0, Math.floor(cx - radius));
      var y0 = Math.max(0, Math.floor(cy - radius));
      var x1 = Math.min(width - 1, Math.ceil(cx + radius));
      var y1 = Math.min(height - 1, Math.ceil(cy + radius));
      var sum = 0, x, y, dx, dy, q, weight;

      for (y = y0; y <= y1; y++) {
        for (x = x0; x <= x1; x++) {
          dx = x - cx; dy = y - cy;
          q = Math.sqrt(dx * dx + dy * dy) / radius;
          if (q >= 1) continue;
          weight = 1 - q * q; weight *= weight;
          sum += weight;
        }
      }
      if (sum <= 0) return 0;

      for (y = y0; y <= y1; y++) {
        for (x = x0; x <= x1; x++) {
          dx = x - cx; dy = y - cy;
          q = Math.sqrt(dx * dx + dy * dy) / radius;
          if (q >= 1) continue;
          weight = 1 - q * q; weight *= weight;
          field[y * width + x] += amount * weight / sum;
        }
      }
      return amount;
    }

    function pressurePulse(state, cx, cy, radius, strength, selfLayer) {
      strength = Math.max(0, strength);
      if (strength <= 0) return;
      var width = state.width, height = state.height;
      var reach = Math.max(2, radius * 2.5);
      var x0 = Math.max(0, Math.floor(cx - reach));
      var y0 = Math.max(0, Math.floor(cy - reach));
      var x1 = Math.min(width - 1, Math.ceil(cx + reach));
      var y1 = Math.min(height - 1, Math.ceil(cy + reach));
      var phase = state.layers.length * 1.61803398875;

      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var dx = x - cx, dy = y - cy;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= 0.001 || distance >= reach) continue;
          var q = distance / reach;
          var envelope = q * (1 - q);
          envelope *= envelope * 8;
          var nx = dx / distance, ny = dy / distance;
          var angle = Math.atan2(dy, dx);
          var wobble = Math.sin(angle * 5 + phase) * 0.12 * envelope;
          var i = y * width + x;
          var pushX = strength * envelope * (nx - ny * wobble);
          var pushY = strength * envelope * (ny + nx * wobble);
          state.vx[i] += pushX;
          state.vy[i] += pushY;
          if (selfLayer) {
            selfLayer.svx[i] += pushX;
            selfLayer.svy[i] += pushY;
          }
        }
      }
    }

    function inject(state, layerIndex, cx, cy, options) {
      options = options || {};
      var radius = Math.max(1, +options.radius || 1);
      var amount = Math.max(0, +options.amount || 0);
      var interaction = clamp(+options.interaction || 0, 0, 1);
      var layer = state.layers[layerIndex];
      if (!layer) return 0;
      var placed = deposit(layer.field, state.width, state.height, cx, cy, radius, amount);
      if (interaction > 0 && placed > 0) {
        var density = placed / Math.max(1, Math.PI * radius * radius);
        pressurePulse(state, cx, cy, radius, interaction * (0.28 + density * 7.5), layer);
      }
      return placed;
    }

    function injectPixel(state, layerIndex, x, y, interaction, load) {
      var layer = state.layers[layerIndex];
      if (!layer) return 0;
      interaction = clamp(+interaction || 0, 0, 1);
      load = load == null ? 2.4 : Math.max(0, +load);
      var placed = deposit(layer.field, state.width, state.height, Math.round(x), Math.round(y), 1.6, load);
      if (interaction > 0 && placed > 0) {
        pressurePulse(state, Math.round(x), Math.round(y), 1.35, interaction * 0.24, layer);
      }
      return placed;
    }

    function injectScreenDot(state, layerIndex, x, y, radius, interaction, load) {
      var layer = state.layers[layerIndex];
      if (!layer) return 0;
      radius = Math.max(0.9, +radius || 0);
      interaction = clamp(+interaction || 0, 0, 1);
      load = load == null ? radius * radius * 2.2 : Math.max(0, +load);
      var placed = deposit(layer.field, state.width, state.height, x, y, radius, load);
      if (interaction > 0 && placed > 0) {
        pressurePulse(state, x, y, radius, interaction * 0.24, layer);
      }
      return placed;
    }

    function injectWaterPixel(state, x, y, strength) {
      strength = strength == null ? 1 : clamp(+strength || 0, 0, 1);
      if (strength <= 0) return 0;
      x = Math.round(x); y = Math.round(y);
      var width = state.width, height = state.height;
      var radius = 2.15, moved = 0;
      var x0 = Math.max(0, Math.floor(x - radius));
      var y0 = Math.max(0, Math.floor(y - radius));
      var x1 = Math.min(width - 1, Math.ceil(x + radius));
      var y1 = Math.min(height - 1, Math.ceil(y + radius));

      for (var k = 0; k < state.layers.length; k++) {
        var field = state.layers[k].field;
        var transfers = [];
        for (var py = y0; py <= y1; py++) {
          for (var px = x0; px <= x1; px++) {
            var dx = px - x, dy = py - y;
            var distance = Math.sqrt(dx * dx + dy * dy);
            if (distance >= radius) continue;
            var fraction = (1 - distance / radius);
            fraction = fraction * fraction * strength;
            var i = py * width + px;
            var amount = field[i] * fraction;
            if (amount <= 1e-12) continue;
            field[i] -= amount;
            var angle = distance > 0.001 ? Math.atan2(dy, dx) : (k + 1) * 2.3999632297;
            var targetRadius = radius + 1.15;
            transfers.push([x + Math.cos(angle) * targetRadius, y + Math.sin(angle) * targetRadius, amount]);
            moved += amount;
          }
        }
        for (var ti = 0; ti < transfers.length; ti++) {
          scatter(field, width, height, transfers[ti][0], transfers[ti][1], transfers[ti][2]);
        }
      }
      pressurePulse(state, x, y, 1.7, 0.34 * strength, null);
      return moved;
    }

    function coherentBias(x, y, seed) {
      return Math.sin(x * 0.43 + seed * 1.71) * Math.cos(y * 0.37 - seed * 0.83) +
        Math.sin((x + y) * 0.19 + seed * 2.31) * 0.55;
    }

    function createSource(width, height, x, y, seed) {
      var source = {
        width: width,
        height: height,
        seed: +seed || 1,
        frontier: [],
        queued: new Uint8Array(width * height),
        claimed: new Uint8Array(width * height),
        lastX: Math.round(x),
        lastY: Math.round(y)
      };
      addCandidate(source, source.lastX, source.lastY);
      return source;
    }

    function addCandidate(source, x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
      var i = y * source.width + x;
      if (source.claimed[i] || source.queued[i]) return;
      source.queued[i] = 1;
      source.frontier.push(i);
    }

    function retargetSource(source, x, y) {
      x = clamp(Math.round(x), 0, source.width - 1);
      y = clamp(Math.round(y), 0, source.height - 1);
      var dx = x - source.lastX, dy = y - source.lastY;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.max(1, Math.ceil(distance));
      for (var i = 1; i <= steps; i++) {
        addCandidate(source, source.lastX + dx * i / steps, source.lastY + dy * i / steps);
      }
      source.lastX = x; source.lastY = y;
    }

    function claimedNeighbors(source, x, y) {
      var count = 0;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        var nx = x + ox, ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < source.width && ny < source.height &&
            source.claimed[ny * source.width + nx]) count++;
      }
      return count;
    }

    function growSource(source, x, y, count) {
      retargetSource(source, x, y);
      var out = [], width = source.width, height = source.height;
      var tx = clamp(Math.round(x), 0, width - 1);
      var ty = clamp(Math.round(y), 0, height - 1);
      count = Math.max(0, count | 0);

      while (out.length < count) {
        if (!source.frontier.length) addCandidate(source, tx, ty);
        if (!source.frontier.length) break;
        var best = 0, bestScore = Infinity;
        for (var fi = 0; fi < source.frontier.length; fi++) {
          var candidate = source.frontier[fi];
          var cx = candidate % width, cy = (candidate / width) | 0;
          var dx = cx - tx, dy = cy - ty;
          var neighbors = claimedNeighbors(source, cx, cy);
          var score = (dx * dx + dy * dy) * 0.055 +
            coherentBias(cx, cy, source.seed) * 1.9 - neighbors * 0.72;
          if (score < bestScore) { bestScore = score; best = fi; }
        }

        var cell = source.frontier[best];
        var last = source.frontier.pop();
        if (best < source.frontier.length) source.frontier[best] = last;
        source.queued[cell] = 0;
        if (source.claimed[cell]) continue;
        source.claimed[cell] = 1;
        var px = cell % width, py = (cell / width) | 0;
        out.push({ x: px, y: py });
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          if (ox || oy) addCandidate(source, px + ox, py + oy);
        }
      }
      return out;
    }

    function advanceFeed(remainder, pixelsPerSecond, seconds, cap) {
      var total = Math.max(0, +remainder || 0) +
        Math.max(0, +pixelsPerSecond || 0) * Math.max(0, +seconds || 0);
      var count = Math.floor(total + 1e-9);
      cap = cap == null ? count : Math.max(0, cap | 0);
      if (count > cap) count = cap;
      var remainderOut = total - count;
      if (remainderOut < 0 && remainderOut > -1e-8) remainderOut = 0;
      return { count: count, remainder: remainderOut };
    }

    function sample(field, width, height, x, y) {
      x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
      var x0 = Math.floor(x), y0 = Math.floor(y);
      var x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      var tx = x - x0, ty = y - y0;
      var a = field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx;
      var b = field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx;
      return a * (1 - ty) + b * ty;
    }

    function diffuseVectorField(width, height, vx, vy, vxWork, vyWork, blend) {
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var i = y * width + x;
          var l = x > 0 ? i - 1 : i;
          var r = x < width - 1 ? i + 1 : i;
          var u = y > 0 ? i - width : i;
          var d = y < height - 1 ? i + width : i;
          var ul = y > 0 && x > 0 ? i - width - 1 : (y > 0 ? u : (x > 0 ? l : i));
          var ur = y > 0 && x < width - 1 ? i - width + 1 : (y > 0 ? u : (x < width - 1 ? r : i));
          var dl = y < height - 1 && x > 0 ? i + width - 1 : (y < height - 1 ? d : (x > 0 ? l : i));
          var dr = y < height - 1 && x < width - 1 ? i + width + 1 : (y < height - 1 ? d : (x < width - 1 ? r : i));
          var nX = (vx[l] + vx[r] + vx[u] + vx[d]) * 2 + vx[ul] + vx[ur] + vx[dl] + vx[dr];
          var nY = (vy[l] + vy[r] + vy[u] + vy[d]) * 2 + vy[ul] + vy[ur] + vy[dl] + vy[dr];
          vxWork[i] = vx[i] * (1 - blend) + nX * blend / 12;
          vyWork[i] = vy[i] * (1 - blend) + nY * blend / 12;
        }
      }
    }

    function diffuseVelocity(state, viscosity) {
      viscosity = clamp(viscosity, 0, 0.24);
      var blend = viscosity * 4;
      diffuseVectorField(state.width, state.height, state.vx, state.vy, state.vxWork, state.vyWork, blend);
      for (var k = 0; k < state.layers.length; k++) {
        var layer = state.layers[k];
        diffuseVectorField(state.width, state.height, layer.svx, layer.svy, layer.svxWork, layer.svyWork, blend);
      }
    }

    function moveVelocity(state, dt, drag, maxSpeed) {
      var width = state.width, height = state.height, layers = state.layers;
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var i = y * width + x;
          var px = x - state.vxWork[i] * dt;
          var py = y - state.vyWork[i] * dt;
          var vx = sample(state.vxWork, width, height, px, py) * drag;
          var vy = sample(state.vyWork, width, height, px, py) * drag;
          var speed = Math.sqrt(vx * vx + vy * vy);
          var scale = speed > maxSpeed ? maxSpeed / speed : 1;
          state.vxNext[i] = vx * scale;
          state.vyNext[i] = vy * scale;
          for (var k = 0; k < layers.length; k++) {
            var layer = layers[k];
            layer.svx[i] = sample(layer.svxWork, width, height, px, py) * drag * scale;
            layer.svy[i] = sample(layer.svyWork, width, height, px, py) * drag * scale;
          }
        }
      }
      var swap = state.vx; state.vx = state.vxNext; state.vxNext = swap;
      swap = state.vy; state.vy = state.vyNext; state.vyNext = swap;
    }

    function scatter(field, width, height, x, y, amount) {
      x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
      var x0 = Math.floor(x), y0 = Math.floor(y);
      var x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      var tx = x - x0, ty = y - y0;
      field[y0 * width + x0] += amount * (1 - tx) * (1 - ty);
      field[y0 * width + x1] += amount * tx * (1 - ty);
      field[y1 * width + x0] += amount * (1 - tx) * ty;
      field[y1 * width + x1] += amount * tx * ty;
    }

    function advectLayer(state, layerIndex, dt, bleed, repelRow) {
      var width = state.width, height = state.height;
      var layer = state.layers[layerIndex];
      var source = layer.field, target = layer.next;
      target.fill(0);

      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var i = y * width + x, amount = source[i];
          if (amount <= 1e-12) continue;
          
          var evx = 0, evy = 0;
          if (repelRow && repelRow.length === state.layers.length) {
            for (var k = 0; k < state.layers.length; k++) {
              var rw = repelRow[k];
              if (rw > 0) {
                evx += state.layers[k].svx[i] * rw;
                evy += state.layers[k].svy[i] * rw;
              }
            }
          } else {
            evx = state.vx[i] - layer.svx[i];
            evy = state.vy[i] - layer.svy[i];
          }

          scatter(target, width, height, x + evx * dt, y + evy * dt, amount);
        }
      }

      var sa = clamp(layer.selfAttract || 0, 0, 1);
      var hold = sa <= 0.5 ? (1 - sa * 2) : 0;
      var effectiveBleed = clamp(bleed * hold, 0, 0.24);
      var attractCoeff = sa > 0.5 ? (sa - 0.5) * 2 * dt : 0;

      if (effectiveBleed > 0 || attractCoeff > 0) {
        var blend = effectiveBleed * 4;
        for (y = 0; y < height; y++) {
          for (x = 0; x < width; x++) {
            i = y * width + x;
            var c = target[i];
            if (blend > 0) {
              var left = x > 0 ? i - 1 : i, right = x < width - 1 ? i + 1 : i;
              var up = y > 0 ? i - width : i, down = y < height - 1 ? i + width : i;
              var upLeft = y > 0 && x > 0 ? i - width - 1 : (y > 0 ? up : (x > 0 ? left : i));
              var upRight = y > 0 && x < width - 1 ? i - width + 1 : (y > 0 ? up : (x < width - 1 ? right : i));
              var downLeft = y < height - 1 && x > 0 ? i + width - 1 : (y < height - 1 ? down : (x > 0 ? left : i));
              var downRight = y < height - 1 && x < width - 1 ? i + width + 1 : (y < height - 1 ? down : (x < width - 1 ? right : i));
              var neighbors = (target[left] + target[right] + target[up] + target[down]) * 2 +
                target[upLeft] + target[upRight] + target[downLeft] + target[downRight];
              source[i] = Math.max(0, c * (1 - blend) + neighbors * blend / 12);
            } else {
              source[i] = c;
            }
          }
        }

        if (attractCoeff > 0) {
          var alpha = attractCoeff * 0.25;
          var size = width * height;
          if (!state.workFlux || state.workFlux.length !== size) {
            state.workFlux = new Float32Array(size);
          } else {
            state.workFlux.fill(0);
          }
          var netFlux = state.workFlux;
          var kScale = 0.5;

          for (y = 0; y < height; y++) {
            for (x = 0; x < width; x++) {
              i = y * width + x;
              var ci = source[i];
              
              if (x < width - 1) {
                var jR = i + 1, cjR = source[jR], dR = ci - cjR;
                if (dR > 0) {
                  var fR = (2 / 12) * alpha * Math.tanh(dR / kScale) * (cjR < kScale ? cjR : kScale);
                  netFlux[i] += fR; netFlux[jR] -= fR;
                } else if (dR < 0) {
                  var fR = (2 / 12) * alpha * Math.tanh(-dR / kScale) * (ci < kScale ? ci : kScale);
                  netFlux[i] -= fR; netFlux[jR] += fR;
                }
              }
              if (y < height - 1) {
                var jD = i + width, cjD = source[jD], dD = ci - cjD;
                if (dD > 0) {
                  var fD = (2 / 12) * alpha * Math.tanh(dD / kScale) * (cjD < kScale ? cjD : kScale);
                  netFlux[i] += fD; netFlux[jD] -= fD;
                } else if (dD < 0) {
                  var fD = (2 / 12) * alpha * Math.tanh(-dD / kScale) * (ci < kScale ? ci : kScale);
                  netFlux[i] -= fD; netFlux[jD] += fD;
                }
              }
              if (y < height - 1 && x > 0) {
                var jDL = i + width - 1, cjDL = source[jDL], dDL = ci - cjDL;
                if (dDL > 0) {
                  var fDL = (1 / 12) * alpha * Math.tanh(dDL / kScale) * (cjDL < kScale ? cjDL : kScale);
                  netFlux[i] += fDL; netFlux[jDL] -= fDL;
                } else if (dDL < 0) {
                  var fDL = (1 / 12) * alpha * Math.tanh(-dDL / kScale) * (ci < kScale ? ci : kScale);
                  netFlux[i] -= fDL; netFlux[jDL] += fDL;
                }
              }
              if (y < height - 1 && x < width - 1) {
                var jDR = i + width + 1, cjDR = source[jDR], dDR = ci - cjDR;
                if (dDR > 0) {
                  var fDR = (1 / 12) * alpha * Math.tanh(dDR / kScale) * (cjDR < kScale ? cjDR : kScale);
                  netFlux[i] += fDR; netFlux[jDR] -= fDR;
                } else if (dDR < 0) {
                  var fDR = (1 / 12) * alpha * Math.tanh(-dDR / kScale) * (ci < kScale ? ci : kScale);
                  netFlux[i] -= fDR; netFlux[jDR] += fDR;
                }
              }
            }
          }

          for (i = 0; i < size; i++) {
            source[i] = Math.max(0, source[i] + netFlux[i]);
          }
        }
      } else {
        layer.field = target;
        layer.next = source;
      }
    }

    function step(state, options) {
      options = options || {};
      var dt = clamp(options.dt == null ? 1 : +options.dt, 0.05, 2);
      var viscosity = options.viscosity == null ? 0.16 : +options.viscosity;
      var drag = Math.pow(options.drag == null ? 0.935 : clamp(+options.drag, 0, 1), dt);
      var maxSpeed = options.maxSpeed == null ? 2.8 : Math.max(0.1, +options.maxSpeed);
      var bleed = (options.bleed == null ? 0 : +options.bleed) * dt;
      var repelMatrix = options.repelMatrix || null;
      diffuseVelocity(state, viscosity * dt);
      moveVelocity(state, dt, drag, maxSpeed);
      for (var i = 0; i < state.layers.length; i++) {
        var repelRow = (repelMatrix && repelMatrix[i]) ? repelMatrix[i] : null;
        advectLayer(state, i, dt, bleed, repelRow);
      }
    }

    function setSelfAttract(layer, value) {
      if (!layer) return 0;
      layer.selfAttract = clamp(+value || 0, 0, 1);
      return layer.selfAttract;
    }

    function mass(field) {
      var total = 0;
      for (var i = 0; i < field.length; i++) total += field[i];
      return total;
    }

    function motion(state) {
      var total = 0;
      for (var i = 0; i < state.vx.length; i++) total += Math.abs(state.vx[i]) + Math.abs(state.vy[i]);
      return total / state.vx.length;
    }

    return {
      create: create,
      addLayer: addLayer,
      deposit: deposit,
      pressurePulse: pressurePulse,
      inject: inject,
      injectPixel: injectPixel,
      injectScreenDot: injectScreenDot,
      injectWaterPixel: injectWaterPixel,
      createSource: createSource,
      growSource: growSource,
      advanceFeed: advanceFeed,
      step: step,
      setSelfAttract: setSelfAttract,
      mass: mass,
      motion: motion
    };
  })();

  // ── 3. BakezuriChain ───────────────────────────────────────────────────
  var Chain = (function () {
    var DEFAULT_MAX_SNAPS = 64;

    function createInitialState() {
      return {
        chain: [],
        pending: null,
        previewIdx: null,
        previewReturn: null,
        maxSnaps: DEFAULT_MAX_SNAPS
      };
    }

    function headIndex(s) { return s.chain.length - 1; }
    function isPreviewing(s) { return s.previewIdx !== null; }
    function lastSnap(s) { return s.chain.length ? s.chain[s.chain.length - 1].snap : null; }
    function canPreview(s, idx) {
      return idx >= 0 && idx < s.chain.length && idx !== headIndex(s) && s.chain[idx].snap != null;
    }
    function buttonLabel(s) { return isPreviewing(s) ? 'revert' : 'undo'; }

    function trim(s) {
      var cut = s.chain.length - s.maxSnaps;
      for (var i = 0; i < cut; i++) s.chain[i].snap = null;
    }

    function exitPreviewToHead(s, field) {
      if (!isPreviewing(s)) return;
      field.restore(s.previewReturn);
      s.previewIdx = null;
      s.previewReturn = null;
    }

    function applyEvent(s, ev, field) {
      switch (ev.t) {
        case 'deposit': {
          exitPreviewToHead(s, field);
          if (!s.pending) s.pending = { type: 'ink', deposits: [] };
          s.pending.deposits.push(ev.ev);
          field.applyDeposit(ev.ev);
          field.resolve();
          return s;
        }
        case 'flushPending': {
          exitPreviewToHead(s, field);
          if (s.pending) {
            var snap = field.snapshot();
            s.chain.push({ kind: 'ink', deposits: s.pending.deposits, snap: snap });
            s.pending = null;
            trim(s);
            field.resolve();
          }
          return s;
        }
        case 'commitBleed': {
          if (s.pending) throw new Error('commitBleed called with pending open — flushPending first');
          if (isPreviewing(s)) exitPreviewToHead(s, field);
          var bsnap = field.snapshot();
          s.chain.push({ kind: 'bleed', steps: ev.n, snap: bsnap });
          trim(s);
          field.resolve();
          return s;
        }
        case 'undo': {
          if (isPreviewing(s)) return s;
          if (s.pending && s.pending.deposits.length) {
            s.pending.deposits.pop();
            field.restore(lastSnap(s));
            for (var i = 0; i < s.pending.deposits.length; i++) field.applyDeposit(s.pending.deposits[i]);
            if (s.pending.deposits.length === 0) s.pending = null;
            field.resolve();
          } else if (s.chain.length) {
            s.chain.pop();
            field.restore(lastSnap(s));
            field.resolve();
          }
          return s;
        }
        case 'revert': {
          if (!isPreviewing(s)) return s;
          var idx = s.previewIdx;
          s.chain = s.chain.slice(0, idx + 1);
          field.restore(s.chain[idx].snap);
          s.pending = null;
          s.previewIdx = null;
          s.previewReturn = null;
          field.resolve();
          return s;
        }
        case 'selectChip': {
          var i2 = ev.idx;
          if (i2 === headIndex(s)) {
            if (isPreviewing(s)) { exitPreviewToHead(s, field); field.resolve(); }
            return s;
          }
          if (!canPreview(s, i2)) return s;
          if (!isPreviewing(s)) s.previewReturn = field.snapshot();
          s.previewIdx = i2;
          field.restore(s.chain[i2].snap);
          field.resolve();
          return s;
        }
        default:
          return s;
      }
    }

    return {
      createInitialState: createInitialState,
      applyEvent: applyEvent,
      headIndex: headIndex,
      isPreviewing: isPreviewing,
      canPreview: canPreview,
      buttonLabel: buttonLabel,
      lastSnap: lastSnap,
      DEFAULT_MAX_SNAPS: DEFAULT_MAX_SNAPS
    };
  })();

  // ── 4. BakezuriRiso ────────────────────────────────────────────────────
  var Riso = (function () {
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
  })();

  // ── 5. BakezuriImage ───────────────────────────────────────────────────
  var ImageMap = (function () {
    function clamp01(value) { return value < 0 ? 0 : (value > 1 ? 1 : value); }

    function fitDimensions(width, height, maxEdge) {
      width = Math.max(1, +width || 1);
      height = Math.max(1, +height || 1);
      maxEdge = Math.max(8, +maxEdge || 240);
      var scale = Math.min(1, maxEdge / Math.max(width, height));
      return {
        width: Math.max(8, Math.round(width * scale)),
        height: Math.max(8, Math.round(height * scale))
      };
    }

    function composite(data, index) {
      var alpha = data[index + 3] / 255;
      return [
        1 - alpha + data[index] / 255 * alpha,
        1 - alpha + data[index + 1] / 255 * alpha,
        1 - alpha + data[index + 2] / 255 * alpha
      ];
    }

    function contrastField(data, width, height) {
      var out = new Float32Array(width * height);
      var luminance = new Float32Array(width * height);
      for (var i = 0; i < luminance.length; i++) {
        var rgb = composite(data, i * 4);
        luminance[i] = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
      }
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var sum = 0, sumSq = 0, count = 0;
          for (var oy = -1; oy <= 1; oy++) {
            var py = Math.max(0, Math.min(height - 1, y + oy));
            for (var ox = -1; ox <= 1; ox++) {
              var px = Math.max(0, Math.min(width - 1, x + ox));
              var value = luminance[py * width + px];
              sum += value; sumSq += value * value; count++;
            }
          }
          var mean = sum / count;
          out[y * width + x] = clamp01(Math.sqrt(Math.max(0, sumSq / count - mean * mean)) * 2.5);
        }
      }
      return out;
    }

    function extract(data, width, height, target) {
      var out = new Float32Array(width * height);
      var contrast = target === 'contrast' ? contrastField(data, width, height) : null;
      for (var i = 0; i < out.length; i++) {
        if (contrast) { out[i] = contrast[i]; continue; }
        var rgb = composite(data, i * 4);
        var r = rgb[0], g = rgb[1], b = rgb[2];
        var luminance = r * 0.299 + g * 0.587 + b * 0.114;
        switch (target) {
          case 'highlights': out[i] = luminance; break;
          case 'r': out[i] = r; break;
          case 'g': out[i] = g; break;
          case 'b': out[i] = b; break;
          case 'cyan': out[i] = 1 - r; break;
          case 'magenta': out[i] = 1 - g; break;
          case 'yellow': out[i] = 1 - b; break;
          case 'brightness':
          default: out[i] = 1 - luminance; break;
        }
      }
      return out;
    }

    return { fitDimensions: fitDimensions, extract: extract, contrastField: contrastField };
  })();

  // ── 6. BakezuriRepel ───────────────────────────────────────────────────
  var Repel = (function () {
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
  })();

  // ── 7. Host Glue Helpers ───────────────────────────────────────────────

  function allocateBath(options) {
    options = options || {};
    var sw = Math.max(8, options.width | 0 || 240);
    var sh = Math.max(8, options.height | 0 || 160);
    var superScale = Math.max(1, options.superScale | 0 || 2);
    var rw = sw * superScale;
    var rh = sh * superScale;
    var paperHex = options.paperHex || '#f2f0df';
    var paperRgb = Basic.hexToRgb ? Basic.hexToRgb(paperHex) : [242 / 255, 240 / 255, 223 / 255];

    var state = Sumi.create ? Sumi.create(sw, sh) : null;

    return {
      sw: sw,
      sh: sh,
      superScale: superScale,
      rw: rw,
      rh: rh,
      paperHex: paperHex,
      paperRgb: paperRgb,
      state: state
    };
  }

  function createRenderPipeline(options) {
    options = options || {};
    var sw = options.sw, sh = options.sh;
    var rw = options.rw, rh = options.rh;
    var targetCtx = options.targetCtx;
    var lowCanvas = options.lowCanvas;
    var lowCtx = options.lowCtx;
    var pixels = options.pixels;

    if (!lowCanvas && typeof document !== 'undefined') {
      lowCanvas = document.createElement('canvas');
      lowCanvas.width = rw;
      lowCanvas.height = rh;
      lowCtx = lowCanvas.getContext('2d');
      pixels = lowCtx.createImageData(rw, rh);
    }

    function render(state, films, paperRgb, density, seam, mixMatrix) {
      if (!targetCtx || !state || !films) return;
      var fields = films.map(function (f) { return f.layer.field; });
      var colours = films.map(function (f) { return f.colour; });

      Basic.resolveSeparatedHi(
        fields, colours, paperRgb, pixels.data,
        rw, rh, sw, sh, density, seam, mixMatrix
      );

      lowCtx.putImageData(pixels, 0, 0);
      targetCtx.drawImage(lowCanvas, 0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
    }

    return {
      render: render,
      lowCanvas: lowCanvas,
      lowCtx: lowCtx,
      pixels: pixels
    };
  }

  function createFilm(state, pigmentIndex, hex, colour, selfAttract) {
    var layer = Sumi.addLayer(state);
    if (selfAttract != null) {
      Sumi.setSelfAttract(layer, selfAttract);
    }
    return {
      layer: layer,
      pigment: pigmentIndex,
      hex: hex,
      colour: colour || (Basic.hexToRgb ? Basic.hexToRgb(hex) : [0, 0, 0])
    };
  }

  var Host = {
    allocateBath: allocateBath,
    createRenderPipeline: createRenderPipeline,
    createFilm: createFilm
  };

  return {
    Basic: Basic,
    Sumi: Sumi,
    Chain: Chain,
    Riso: Riso,
    Image: ImageMap,
    Repel: Repel,
    Host: Host
  };
});
