/* Image-to-single-ink target extraction for Bakezuri.
   RGBA is composited over white before channel mapping, matching paper. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakezuriImage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp01(value) {
    return value < 0 ? 0 : (value > 1 ? 1 : value);
  }

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
});
