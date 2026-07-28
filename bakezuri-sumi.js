/* Minimal live suminagashi field engine.
   Flat pigment layers ride one shared, damped velocity field. Ink application
   adds pigment and, according to interaction, a short outward pressure pulse.
   An ink never repels itself: each layer tracks the velocity its own pulses
   contributed (svx/svy) and subtracts it when advecting its own pigment, so
   fresh ink stays cohesive while everything earlier is pushed aside. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakezuriSumi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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
      // Intramolecular law: how strongly this pigment holds itself together.
      // 0 = diffuses freely with the bath bleed; 1 = frozen, ignores bleed and
      // keeps a sharp edge while looser inks around it feather.
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
    var sum = 0;
    var x, y, dx, dy, q, weight;

    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        dx = x - cx;
        dy = y - cy;
        q = Math.sqrt(dx * dx + dy * dy) / radius;
        if (q >= 1) continue;
        weight = 1 - q * q;
        weight *= weight;
        sum += weight;
      }
    }
    if (sum <= 0) return 0;

    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        dx = x - cx;
        dy = y - cy;
        q = Math.sqrt(dx * dx + dy * dy) / radius;
        if (q >= 1) continue;
        weight = 1 - q * q;
        weight *= weight;
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

        // Mild angular instability prevents mechanically perfect rings while
        // remaining deterministic: pressure creates the irregularity, not noise.
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
    var placed = deposit(layer.field, state.width, state.height,
      Math.round(x), Math.round(y), 1.6, load);
    if (interaction > 0 && placed > 0) {
      pressurePulse(state, Math.round(x), Math.round(y), 1.35, interaction * 0.24, layer);
    }
    return placed;
  }

  // A riso screen opens many small ports at once. Each port gets a wider,
  // radius-aware deposit but the same bounded pressure impulse as one live
  // suminagashi feed cell, preventing dense screens from exploding the bath.
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

  // Water is a pressure-only load. It removes pigment from its small core and
  // places that exact mass just outside the core, then gives the bath an
  // outward pulse. Result: persistent negative space without deleting ink.
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
          transfers.push([x + Math.cos(angle) * targetRadius,
            y + Math.sin(angle) * targetRadius, amount]);
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
        // Distance keeps growth around the feed point. Coherent bias creates
        // tongues and bays; neighbor preference keeps the patch solid.
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
    x = clamp(x, 0, width - 1);
    y = clamp(y, 0, height - 1);
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    var tx = x - x0, ty = y - y0;
    var a = field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx;
    var b = field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx;
    return a * (1 - ty) + b * ty;
  }

  // Isotropic 3x3 smooth of one vector field into its work pair. Orthogonal
  // neighbours weigh 2, diagonals 1 (a Gaussian-ish 2:1 ratio) so momentum
  // spreads in a disk, not a diamond.
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
    // Each layer's self-velocity rides the same transport as the shared field
    // so the subtraction in advectLayer stays aligned frame to frame.
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
        // One backtrace, shared by the velocity field and every self-field, so
        // they all advect coherently and the self subset never diverges.
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
          // Same drag and clamp-scale keep self a true subset of the shared push.
          layer.svx[i] = sample(layer.svxWork, width, height, px, py) * drag * scale;
          layer.svy[i] = sample(layer.svyWork, width, height, px, py) * drag * scale;
        }
      }
    }
    var swap = state.vx; state.vx = state.vxNext; state.vxNext = swap;
    swap = state.vy; state.vy = state.vyNext; state.vyNext = swap;
  }

  function scatter(field, width, height, x, y, amount) {
    x = clamp(x, 0, width - 1);
    y = clamp(y, 0, height - 1);
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
});
