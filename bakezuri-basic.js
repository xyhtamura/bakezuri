/* Minimal Bakezuri mechanics: conserved flat-ink deposition, diffusion, and
   literal flat-colour mixing. No ink types or optical effect modes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakezuriBasic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

  // Suminagashi colours remain separate even when their scalar fields overlap.
  // Whichever ink has the strongest local load owns the cell; later inks win
  // exact ties, matching the physical act of laying a new film on the bath.
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

  // De-gridding resolver. The scalar load fields are the *encoded* layer (a
  // coarse wet matrix); this paints a finer *render* layer by sampling those
  // fields as continuous functions, so the cell lattice never reaches the eye.
  //   Edge A (ink vs paper): coverage is 1-exp(-load) of the bilinearly
  //     interpolated load, so the pigment boundary ramps smoothly instead of
  //     stepping cell to cell.
  //   Edge B (ink vs ink): inks stay separate — the strongest local load owns
  //     the pixel (later inks win ties, matching a new film laid on the bath) —
  //     but pixels straddling the equal-load curve blend the two owners in
  //     proportion to how far inside the seam they sit. Pure colour everywhere
  //     except a thin anti-aliased boundary; steep seams stay crisp, diffuse
  //     ones feather on their own. `seam` is the blend half-width in load units.
  //   Mix law (optional `mixMatrix[i][j]` in 0..1): a render-time colour law,
  //     not a sim change. Where films i and j overlap, their colours blend by
  //     mixMatrix[i][j] scaled by the overlap ratio min/max, so the cores stay
  //     pure and only the shared band mixes — and because bleed grows that band
  //     over time, a mixed seam blooms outward from placement. Absent or 0 ⇒
  //     pure separation (only the anti-alias seam blends). This never touches
  //     the encoded fields, so mixing stays reversible.
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
          var frAA = d >= 1 ? 0 : 0.5 * (1 - d);   // anti-alias seam fraction
          var frMix = 0;                            // colour-mix law fraction
          if (mixMatrix && mixMatrix[wi]) {
            var m = mixMatrix[wi][ri] || 0;
            if (m > 0) frMix = 0.5 * m * (lr / lw); // grows with overlap ratio
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
});
