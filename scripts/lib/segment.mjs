// Finding the sky in a painting, and the glass in a painted window.
//
// THIS CODE DOES NOT RUN IN NODE. It is handed to a headless Chrome as source
// text and evaluated there, because the only WebP decoder in this toolchain is
// the browser's and this repository does not add a dependency for one. It is
// written as a real function rather than a template literal so that it is
// ordinary, lint-checked, syntax-highlighted JavaScript instead of a string
// nobody can read; scripts/trace-horizon.mjs stringifies it with toString().
// Everything it needs is inside it for the same reason.
//
// WHAT IT IS FOR
//
// The weather card draws a live sky over a painted clearing, and the clock card
// draws weather behind a painted window. Both need to know where the paint
// stops, to a leaf. A polygon traced as one top and one bottom per column --
// which is what this replaced -- cannot say that: it flattens a lacy canopy
// into a staircase and throws away every gap of sky between the leaves. What
// comes out of here instead is a per-pixel alpha, soft at the edges, which is
// what a hand-painted leaf edge actually is.
//
// HOW THE SKY IS FOUND
//
// 1. BOOTSTRAP, by texture. Sky is brushed flat and foliage is stippled, so the
//    largest low-roughness region hanging from the top of the picture is sky.
//    This is only ever used to get started: roughness is highest exactly ON a
//    leaf edge, so classifying with it erodes the detail we came for.
//
// 2. FIT A SKY FIELD. A painted sky is a strong vertical gradient and nearly
//    flat across, so its colour is estimated with an ANISOTROPIC weighted blur
//    -- narrow down the picture, wide across it -- of the pixels currently
//    believed to be sky. Dividing the blurred signal by the blurred weights
//    (Nadaraya-Watson) extrapolates that estimate into the canopy, where there
//    is no sky to look at, which is what lets a gap between two leaves be
//    compared against the sky that would be behind it.
//
// 3. CLASSIFY, by colour alone, in CIELAB so that a threshold means the same
//    thing in a dark blue night and a pale sage noon. The threshold is not
//    Otsu's: Otsu splits the picture into its two biggest lumps and calls the
//    hazy far treeline sky. It is calibrated instead on paint we are already
//    confident about -- the interior of the current mask, away from every edge
//    -- so it says "sky is what looks like the sky I have", which is a much
//    tighter claim. Four iterations.
//
// 4. KEEP WHAT HANGS FROM THE TOP. The ground is sky-coloured in the night
//    plate, where the clearing is under a moon. It is never connected to the
//    top of the picture, and that is the whole of the rule. Islands that are
//    not connected but lie entirely above the treeline are kept as well: those
//    are gaps through the leaves.
//
// 5. SOFTEN. A tight ramp across the same threshold, so a pixel that is half
//    leaf and half sky comes out half transparent instead of being rounded to
//    one side of the argument.
//
// The four plates of a scene are lit differently and framed identically, so all
// four are segmented and combined by taking the median alpha per pixel.
//
// HOW THE GLASS IS FOUND
//
// Different picture, different cue. Outside, the sky is the flat bright thing.
// In the room, the wall and the glass are both flat, and at dusk both bright
// and both warm; the one thing true in all four plates is that the FRAME and
// the mullions are darker than either. So the panes are flood-filled out from
// the middle of each quadrant and stopped by the dark, and the same soft ramp
// gives the edges back. A fill that reaches the edge of its box has crossed the
// frame and is reported rather than believed.

export async function segmentScene(input) {
  const { plates, mode } = input;

  // ── Small numerics ──────────────────────────────────────────────────────
  const clamp = (value, low, high) => value < low ? low : value > high ? high : value;

  /**
   * Box radii whose repeated application approximates a Gaussian. Three passes
   * is the usual bargain, and it is the reason this runs in seconds: a true
   * Gaussian at sigma 55 is a 441-tap kernel per pixel per pass, and there are
   * four channels, four iterations and four plates of it.
   */
  function boxesFor(sigma, count) {
    if (sigma <= 0) return new Array(count).fill(0);
    const ideal = Math.sqrt(12 * sigma * sigma / count + 1);
    let lower = Math.floor(ideal);
    if (lower % 2 === 0) lower -= 1;
    const upper = lower + 2;
    const split = Math.round((12 * sigma * sigma - count * lower * lower - 4 * count * lower - 3 * count) / (-4 * lower - 4));
    const sizes = [];
    for (let index = 0; index < count; index += 1) sizes.push(((index < split ? lower : upper) - 1) / 2);
    return sizes;
  }

  /**
   * Fold an index back inside the picture by reflecting it about the edge,
   * the pixel at the edge included: -1 reads pixel 0, -2 reads pixel 1.
   *
   * The obvious alternative is to REPEAT the edge pixel, and it is wrong here
   * in a way that took a while to find. The sky's colour is estimated with a
   * blur 55 pixels wide, so within a border that wide the estimate is mostly
   * whatever the border does; repeating the edge pixel smears the leftmost
   * column across it. In the night plate, where a near-black canopy meets a
   * near-black sky, that was enough to make the top-left corner look like sky
   * -- a thousand pixels of it -- while the other three plates read it as tree.
   */
  function reflect(index, size) {
    let value = index;
    while (value < 0 || value >= size) {
      if (value < 0) value = -value - 1;
      if (value >= size) value = 2 * size - value - 1;
    }
    return value;
  }

  // One box pass along one axis, with a running sum.
  function boxPass(source, width, height, radius, horizontal) {
    const out = new Float32Array(source.length);
    if (radius < 1) { out.set(source); return out; }
    const norm = 1 / (radius * 2 + 1);
    if (horizontal) {
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let sum = 0;
        for (let index = -radius; index <= radius; index += 1) sum += source[row + reflect(index, width)];
        for (let x = 0; x < width; x += 1) {
          out[row + x] = sum * norm;
          sum += source[row + reflect(x + radius + 1, width)] - source[row + reflect(x - radius, width)];
        }
      }
    } else {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let index = -radius; index <= radius; index += 1) sum += source[reflect(index, height) * width + x];
        for (let y = 0; y < height; y += 1) {
          out[y * width + x] = sum * norm;
          sum += source[reflect(y + radius + 1, height) * width + x] - source[reflect(y - radius, height) * width + x];
        }
      }
    }
    return out;
  }

  function blur(source, width, height, sigmaY, sigmaX) {
    let values = source;
    for (const radius of boxesFor(sigmaX, 3)) values = boxPass(values, width, height, radius, true);
    for (const radius of boxesFor(sigmaY, 3)) values = boxPass(values, width, height, radius, false);
    return values;
  }

  function percentile(values, fraction, where) {
    const picked = [];
    for (let index = 0; index < values.length; index += 1) if (!where || where[index]) picked.push(values[index]);
    if (!picked.length) return 0;
    picked.sort((a, b) => a - b);
    return picked[clamp(Math.floor(picked.length * fraction), 0, picked.length - 1)];
  }

  // sRGB to CIELAB, D65. A threshold in here is a perceptual distance, which is
  // what lets one number serve a midnight plate and a noon one.
  function toLab(r, g, b) {
    const linear = value => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const R = linear(r), G = linear(g), B = linear(b);
    const x = (R * 0.412453 + G * 0.357580 + B * 0.180423) / 0.95047;
    const y = R * 0.212671 + G * 0.715160 + B * 0.072169;
    const z = (R * 0.019334 + G * 0.119193 + B * 0.950227) / 1.08883;
    const f = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  // ── Shapes ──────────────────────────────────────────────────────────────

  // Label connected regions, four-connected, iteratively: a picture this size
  // recurses tens of thousands deep and a recursive fill overflows the stack.
  function components(mask, width, height) {
    const labels = new Int32Array(mask.length).fill(-1);
    const sizes = [];
    const stack = [];
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || labels[start] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      stack.push(start);
      labels[start] = id;
      while (stack.length) {
        const at = stack.pop();
        size += 1;
        const x = at % width, y = (at - x) / width;
        if (x > 0 && mask[at - 1] && labels[at - 1] < 0) { labels[at - 1] = id; stack.push(at - 1); }
        if (x < width - 1 && mask[at + 1] && labels[at + 1] < 0) { labels[at + 1] = id; stack.push(at + 1); }
        if (y > 0 && mask[at - width] && labels[at - width] < 0) { labels[at - width] = id; stack.push(at - width); }
        if (y < height - 1 && mask[at + width] && labels[at + width] < 0) { labels[at + width] = id; stack.push(at + width); }
      }
      sizes.push(size);
    }
    return { labels, sizes };
  }

  /** The biggest region touching the top edge — which is what a sky is. */
  function hangingFromTop(mask, width, height) {
    const { labels, sizes } = components(mask, width, height);
    const rows = Math.max(1, Math.round(height * 0.04));
    const touching = new Set();
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < width; x += 1) {
      const id = labels[y * width + x];
      if (id >= 0) touching.add(id);
    }
    let best = -1;
    for (const id of touching) if (best < 0 || sizes[id] > sizes[best]) best = id;
    const out = new Uint8Array(mask.length);
    if (best < 0) return { mask: out, labels, sizes, best };
    for (let index = 0; index < mask.length; index += 1) if (labels[index] === best) out[index] = 1;
    return { mask: out, labels, sizes, best };
  }

  // Separable min (erode) and max (dilate) over a square.
  function morph(mask, width, height, radius, dilate) {
    const pick = dilate ? Math.max : Math.min;
    const pass = (source, horizontal) => {
      const out = new Uint8Array(source.length);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        let value = source[y * width + x];
        for (let step = -radius; step <= radius; step += 1) {
          const sx = horizontal ? clamp(x + step, 0, width - 1) : x;
          const sy = horizontal ? y : clamp(y + step, 0, height - 1);
          value = pick(value, source[sy * width + sx]);
        }
        out[y * width + x] = value;
      }
      return out;
    };
    return pass(pass(mask, true), false);
  }

  // ── Reading a plate ─────────────────────────────────────────────────────

  // `into` is the size of the first plate read. Every later plate is drawn to
  // that size rather than its own, because the plates are NOT all the same
  // number of pixels -- the dawn exterior is a row taller than the other three
  // -- and every one of them is painted at background-size:100% 100%, so the
  // card stretches them all to one rectangle. Combining them at their own sizes
  // means row 300 of one plate is compared against a slightly different line of
  // the picture in another. It is under a pixel here, and it is still the kind
  // of thing that is much easier to rule out than to find later.
  async function readPlate(url, into) {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = into ? into.width : image.naturalWidth;
    const height = into ? into.height : image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const count = width * height;
    const lightness = new Float32Array(count), a = new Float32Array(count), b = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const lab = toLab(pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2]);
      lightness[index] = lab[0]; a[index] = lab[1]; b[index] = lab[2];
    }
    return { width, height, pixels, lightness, a, b };
  }

  /** How stippled the paint is here. Sky is brushed flat; foliage is not. */
  function roughnessOf(lightness, width, height) {
    const soft = blur(lightness, width, height, 2, 2);
    const deviation = new Float32Array(lightness.length);
    for (let index = 0; index < lightness.length; index += 1) deviation[index] = Math.abs(lightness[index] - soft[index]);
    return blur(deviation, width, height, 2, 2);
  }

  // ── The sky ─────────────────────────────────────────────────────────────

  function segmentSky(plate, settings) {
    const { width, height, lightness, a, b } = plate;
    const count = width * height;
    const rough = roughnessOf(lightness, width, height);

    // A pixel is sky if it is close to the fitted sky AND the fit had something
    // to go on there. The second half is not pedantry. Far inside the canopy
    // the blur that estimates the sky's colour has no sky within reach, its
    // weight goes to nothing, and dividing by nothing turns the estimate into
    // black -- against which the near-black top-left corner of the NIGHT plate
    // reads as a perfect match, and a thousand pixels of tree get called sky on
    // one plate out of four. Where there is no evidence the answer is "not
    // sky", not "whatever the arithmetic happens to say".
    const believable = index => distance[index] < threshold && evidence[index] > settings.evidence;

    const flat = new Uint8Array(count);
    const roughGate = percentile(rough, 0.30);
    for (let index = 0; index < count; index += 1) flat[index] = rough[index] < roughGate ? 1 : 0;
    let mask = hangingFromTop(flat, width, height).mask;

    const distance = new Float32Array(count);
    // How much of the sky field's estimate at each pixel actually came from
    // pixels believed to be sky. Kept out of the loop because the last round's
    // is what the answer is built from.
    let evidence = new Float32Array(count);
    let threshold = 0;
    const confidentGate = percentile(rough, 0.40);
    for (let round = 0; round < settings.iterations; round += 1) {
      // The colour of the sky, estimated where it is visible and carried into
      // the canopy where it is not. Narrow down the picture, wide across it.
      const weight = new Float32Array(count);
      for (let index = 0; index < count; index += 1) weight[index] = mask[index];
      const density = blur(weight, width, height, settings.sigmaY, settings.sigmaX);
      evidence = density;
      const fields = [lightness, a, b].map(channel => {
        const scaled = new Float32Array(count);
        for (let index = 0; index < count; index += 1) scaled[index] = channel[index] * weight[index];
        return blur(scaled, width, height, settings.sigmaY, settings.sigmaX);
      });
      for (let index = 0; index < count; index += 1) {
        const scale = 1 / Math.max(density[index], 1e-9);
        const dl = lightness[index] - fields[0][index] * scale;
        const da = a[index] - fields[1][index] * scale;
        const db = b[index] - fields[2][index] * scale;
        distance[index] = Math.sqrt(dl * dl + da * da + db * db);
      }

      // Calibrate on the interior of what we already believe, away from every
      // edge: that is paint we are confident about, and the only place a
      // "how far off is sky allowed to be" number can honestly come from.
      const core = morph(mask, width, height, 3, false);
      const confident = new Uint8Array(count);
      let confidentCount = 0;
      for (let index = 0; index < count; index += 1) {
        confident[index] = core[index] && rough[index] < confidentGate ? 1 : 0;
        confidentCount += confident[index];
      }
      threshold = Math.max(settings.floor,
        percentile(distance, 0.98, confidentCount > 200 ? confident : mask) * settings.factor);

      const near = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) near[index] = believable(index) ? 1 : 0;
      const grown = hangingFromTop(near, width, height);
      let size = 0;
      for (let index = 0; index < count; index += 1) size += grown.mask[index];
      if (size < 500) break;
      mask = grown.mask;
    }

    // The treeline, per column: the lowest row the sky reaches.
    const seam = new Float32Array(width);
    const known = [];
    for (let x = 0; x < width; x += 1) {
      let lowest = -1;
      for (let y = height - 1; y >= 0; y -= 1) if (mask[y * width + x]) { lowest = y; break; }
      seam[x] = lowest;
      if (lowest >= 0) known.push(x);
    }
    for (let x = 0; x < width; x += 1) {
      if (seam[x] >= 0) continue;
      let before = x, after = x;
      while (before > 0 && seam[before] < 0) before -= 1;
      while (after < width - 1 && seam[after] < 0) after += 1;
      seam[x] = Math.max(seam[before] < 0 ? 0 : seam[before], seam[after] < 0 ? 0 : seam[after]);
    }
    const smoothSeam = blur(seam, width, 1, 0, 2);

    // Islands of sky that hang from nothing: gaps between leaves, if they are
    // above the treeline, and something else entirely if they are below it.
    const near = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) near[index] = believable(index) ? 1 : 0;
    const { labels, sizes } = components(near, width, height);
    const island = new Map();
    for (let index = 0; index < count; index += 1) {
      const id = labels[index];
      if (id < 0 || mask[index]) continue;
      const x = index % width, y = (index - x) / width;
      const entry = island.get(id) ?? { below: false };
      if (y > smoothSeam[x]) entry.below = true;
      island.set(id, entry);
    }
    const keep = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      if (mask[index]) { keep[index] = 1; continue; }
      const id = labels[index];
      if (id < 0 || sizes[id] < 2) continue;
      if (!island.get(id)?.below) keep[index] = 1;
    }
    const reach = morph(keep, width, height, 1, true);

    // The soft edge. A pixel that is half leaf and half sky sits halfway across
    // this ramp, which is exactly what its alpha should be.
    const low = threshold * settings.softLow, high = threshold * settings.softHigh;
    const alpha = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      if (!reach[index]) continue;
      const x = index % width, y = (index - x) / width;
      if (y > smoothSeam[x] + 2) continue;
      alpha[index] = clamp((high - distance[index]) / (high - low), 0, 1);
    }
    return { alpha, seam: smoothSeam, threshold };
  }

  // ── The window ──────────────────────────────────────────────────────────

  function findWindowBox(plate) {
    const { width, height, pixels } = plate;
    let left = width, right = -1, top = height, bottom = -1;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      // The glass is the only cool thing in a warm room: it is the outdoors.
      if (pixels[index + 2] - pixels[index] <= 15) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    if (right < 0) return null;
    const pad = Math.round((right - left) * 0.22);
    return {
      left: Math.max(0, left - pad), right: Math.min(width - 1, right + pad),
      top: Math.max(0, top - pad), bottom: Math.min(height - 1, bottom + pad),
    };
  }

  function segmentWindow(plate, box, settings) {
    const { width, height, lightness } = plate;
    const count = width * height;
    const soft = blur(lightness, width, height, 1, 1);

    const inside = [];
    for (let y = box.top; y <= box.bottom; y += 1) for (let x = box.left; x <= box.right; x += 1) inside.push(soft[y * width + x]);
    inside.sort((a, b) => a - b);
    const frameLevel = inside[Math.floor(inside.length * 0.2)];
    const glassLevel = inside[Math.floor(inside.length * 0.75)];
    const gate = frameLevel + (glassLevel - frameLevel) * settings.gate;

    const boxWidth = box.right - box.left + 1, boxHeight = box.bottom - box.top + 1;
    const filled = new Uint8Array(count);
    let escaped = false;
    for (const fx of [0.34, 0.66]) for (const fy of [0.36, 0.68]) {
      const seed = Math.round(box.top + boxHeight * fy) * width + Math.round(box.left + boxWidth * fx);
      if (soft[seed] <= gate || filled[seed]) continue;
      const stack = [seed];
      filled[seed] = 1;
      while (stack.length) {
        const at = stack.pop();
        const x = at % width, y = (at - x) / width;
        if (x === box.left || x === box.right || y === box.top || y === box.bottom) escaped = true;
        for (const next of [at - 1, at + 1, at - width, at + width]) {
          const nx = next % width, ny = (next - nx) / width;
          if (nx < box.left || nx > box.right || ny < box.top || ny > box.bottom) continue;
          if (filled[next] || soft[next] <= gate) continue;
          filled[next] = 1;
          stack.push(next);
        }
      }
    }

    // The same soft edge, on the frame's own contrast: the painted mullion has
    // a soft side, and a mask that steps a whole pixel at it shows a staircase.
    const band = Math.max(1, (glassLevel - frameLevel) * settings.band);
    const reach = morph(filled, width, height, 2, true);
    const alpha = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      if (!reach[index]) continue;
      alpha[index] = clamp((soft[index] - (gate - band)) / (2 * band), 0, 1);
    }

    // How far down the glass there is sky rather than painted trees. No seam to
    // trace: the painter faded the trees in, so the honest answer is the row
    // where a profile of the panes crosses halfway down its own range.
    const means = new Float32Array(boxHeight), widths = new Int32Array(boxHeight);
    for (let y = 0; y < boxHeight; y += 1) {
      let sum = 0, n = 0;
      for (let x = 0; x < boxWidth; x += 1) {
        const index = (box.top + y) * width + box.left + x;
        if (alpha[index] < 0.5) continue;
        sum += soft[index]; n += 1;
      }
      means[y] = n ? sum / n : 0; widths[y] = n;
    }
    let widest = 0;
    for (const value of widths) widest = Math.max(widest, value);
    const usable = [];
    for (let y = 0; y < boxHeight; y += 1) if (widths[y] > widest * 0.55) usable.push(means[y]);
    usable.sort((a, b) => b - a);
    let skyEnd = null;
    if (usable.length > 8) {
      const half = (usable[Math.floor(usable.length * 0.1)] + usable[Math.floor(usable.length * 0.9)]) / 2;
      for (let y = 0; y < boxHeight; y += 1) {
        if (widths[y] <= widest * 0.55 || means[y] > half) continue;
        skyEnd = y; break;
      }
    }
    return { alpha, escaped, gate, skyEnd, box };
  }

  // ── Combine and hand back ───────────────────────────────────────────────

  function medianAlpha(maps, count) {
    const out = new Float32Array(count);
    const bucket = new Array(maps.length);
    for (let index = 0; index < count; index += 1) {
      for (let m = 0; m < maps.length; m += 1) bucket[m] = maps[m][index];
      bucket.sort((a, b) => a - b);
      out[index] = maps.length % 2
        ? bucket[maps.length >> 1]
        : (bucket[(maps.length >> 1) - 1] + bucket[maps.length >> 1]) / 2;
    }
    return out;
  }

  // White everywhere, and the alpha is the answer. A CSS mask reads the alpha
  // channel, and a flat white RGB compresses to almost nothing.
  function toPng(alpha, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(width, height);
    for (let index = 0; index < alpha.length; index += 1) {
      image.data[index * 4] = 255; image.data[index * 4 + 1] = 255; image.data[index * 4 + 2] = 255;
      image.data[index * 4 + 3] = Math.round(clamp(alpha[index], 0, 1) * 255);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  const read = [];
  for (const entry of plates) {
    read.push({ plate: entry.plate, ...await readPlate(entry.url, read.length ? read[0] : null) });
  }
  const { width, height } = read[0];
  const count = width * height;

  if (mode === 'sky') {
    const each = read.map(plate => {
      const result = segmentSky(plate, input.settings);
      let area = 0;
      for (const value of result.alpha) area += value;
      return { plate: plate.plate, threshold: +result.threshold.toFixed(2), area: area / count, result };
    });
    const alpha = medianAlpha(each.map(entry => entry.result.alpha), count);
    // The extent of the combined answer, column by column: the treeline it
    // reaches down to, the canopy it reaches up to, and whether this column has
    // any sky in it at all. This is what the sun's arc is hung on, and it is
    // read off the finished mask rather than kept from some earlier stage, so
    // the numbers and the picture cannot describe different horizons.
    const seam = new Float32Array(width), crown = new Float32Array(width), has = new Uint8Array(width);
    for (let x = 0; x < width; x += 1) {
      let lowest = -1, highest = -1;
      for (let y = height - 1; y >= 0; y -= 1) if (alpha[y * width + x] >= 0.5) { lowest = y; break; }
      for (let y = 0; y < height; y += 1) if (alpha[y * width + x] >= 0.5) { highest = y; break; }
      has[x] = lowest >= 0 ? 1 : 0;
      seam[x] = (lowest < 0 ? 0 : lowest) / height;
      crown[x] = (highest < 0 ? 0 : highest) / height;
    }
    // How much the plates disagree, and -- the part that matters -- how much of
    // that is anywhere a registration fault could hide.
    //
    // Nearly all of it never is. Four plates painted from one composition still
    // land their leaf edges a pixel apart, so along every edge one plate says
    // solid sky where another says solid leaf. Counting those is counting the
    // brushwork: measured over the whole picture it comes to 1.5%, of which 99%
    // is within three pixels of an edge, spread evenly over all four plates and
    // over the whole card. A plate that had genuinely MOVED would disagree
    // somewhere else -- in the middle of open sky, or the middle of a tree --
    // and that is what is gated. Same lesson as measuring a seam across itself
    // rather than down a column: gate the thing that would indicate the fault.
    const soft = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) soft[index] = alpha[index] > 0.08 && alpha[index] < 0.92 ? 1 : 0;
    const nearEdge = morph(soft, width, height, 3, true);
    let uncertain = 0, area = 0, disagreement = 0, edgeDisagreement = 0;
    for (let index = 0; index < count; index += 1) {
      area += alpha[index];
      uncertain += soft[index];
      let low = 1, high = 0;
      for (const entry of each) {
        low = Math.min(low, entry.result.alpha[index]);
        high = Math.max(high, entry.result.alpha[index]);
      }
      if (!(high >= 0.8 && low <= 0.2)) continue;
      edgeDisagreement += 1;
      if (!nearEdge[index]) disagreement += 1;
    }
    return {
      width, height, mask: toPng(alpha, width, height),
      seam: Array.from(seam), crown: Array.from(crown), has: Array.from(has),
      plates: each.map(entry => ({ plate: entry.plate, threshold: entry.threshold, area: +(entry.area * 100).toFixed(2) })),
      perPlate: input.debug ? each.map(e => ({ plate: e.plate, mask: toPng(e.result.alpha, width, height) })) : undefined,
      counts: { total: count, soft: uncertain, nearEdge: (() => { let n = 0; for (const v of nearEdge) n += v; return n; })(), edgeDis: edgeDisagreement, offEdge: disagreement },
      area: +(area / count * 100).toFixed(2),
      uncertain: +(uncertain / count * 100).toFixed(2),
      disagreement: +(disagreement / count * 100).toFixed(3),
      edgeDisagreement: +(edgeDisagreement / count * 100).toFixed(2),
    };
  }

  // The window's box is found once, on the plate where the glass is the only
  // cool thing in the room, and handed to the rest.
  const box = input.box ?? findWindowBox(read.find(plate => plate.plate === 'day') ?? read[0]);
  if (!box) return { error: 'no window found: nothing in the day plate is cooler than the room' };
  const each = read.map(plate => ({ plate: plate.plate, result: segmentWindow(plate, box, input.settings) }));
  const voting = each.filter(entry => !entry.result.escaped);
  const counted = voting.length ? voting : each;
  const alpha = medianAlpha(counted.map(entry => entry.result.alpha), count);
  const ends = counted.map(entry => entry.result.skyEnd).filter(value => value !== null).sort((a, b) => a - b);
  let area = 0;
  for (const value of alpha) area += value;
  return {
    width, height, box, mask: toPng(alpha, width, height),
    skyEnd: (box.top + (ends.length ? ends[ends.length >> 1] : (box.bottom - box.top) * 0.45)) / height,
    escaped: each.filter(entry => entry.result.escaped).map(entry => entry.plate),
    counted: counted.map(entry => entry.plate),
    ends: counted.map(entry => ({ plate: entry.plate, at: entry.result.skyEnd })),
    gates: each.map(entry => ({ plate: entry.plate, gate: +entry.result.gate.toFixed(1) })),
    area: +(area / count * 100).toFixed(3),
  };
}
