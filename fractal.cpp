/*
Welcome to my code that helps run my fractal viewer. All the code is licensed
under GNU Affero General Public License v3. and is open source in case you want
to use it! It is compiled into WASM, and the exported functions can then be
executed by JavaScript.

The code will use double for normal calculations then Bilinear Approximation and
pertubation (not finished for all hybrids.) Memory regions image should be in
the README (GitHub version at https://github.com/plasma4/FractalSky/)
*/

#include <algorithm>
#include <stdint.h>

// We don't need to include math.h if we add these functions.
float sqrtf(float x);
double sqrt(double x);
double floor(double x);

#define sqrtf __builtin_sqrtf
#define sqrt __builtin_sqrt
#define floor __builtin_floor

#ifndef likely
#define likely(x) __builtin_expect(!!(x), 1)
#endif
#ifndef unlikely
#define unlikely(x) __builtin_expect(!!(x), 0)
#endif

namespace Mem {
// Pixel counter
constexpr uint32_t AtomicCounter = 0;
// Amount of limbs (for Decimal use), set to 0 for no limbs
constexpr uint32_t LimbCount = 8;

// Lookup tables (Shading is 64KB and PaletteData is 1000KB)
constexpr uint32_t ShadingLUT = 32;
constexpr uint32_t PaletteData = ShadingLUT + 65536;
// 16 Decimal instances use 32 uint64_t's for 256 bytes/Decimal
constexpr uint32_t DecimalStorage = PaletteData + 100000;

// This is where the per-pixel data starts.
constexpr uint32_t PixelDataStart = DecimalStorage + 4096;
} // namespace Mem

constexpr int CALC_CHUNK_SIZE = 32;
constexpr int RENDER_CHUNK_SIZE = 4096;
const double BAILOUT_VALUE = 10000.0;

static inline double absD(double x) { return std::fabs(x); }

// Fast mixing (smoothing) of 32-bit colors
static inline uint32_t mix(uint32_t colorStart, uint32_t colorEnd, uint32_t a) {
  uint32_t reverse = 0xff - a;
  uint32_t r = (((colorStart & 0xff) * reverse + (colorEnd & 0xff) * a) >> 8);
  uint32_t g =
      ((((colorStart >> 8) & 0xff) * reverse + ((colorEnd >> 8) & 0xff) * a) >>
       8)
      << 8;
  uint32_t b = ((((colorStart >> 16) & 0xff) * reverse +
                 ((colorEnd >> 16) & 0xff) * a) >>
                8)
               << 16;
  return r ^ g ^ b ^ 0xff000000;
}

static inline uint32_t mixBlack(uint32_t colorStart, uint32_t a) {
  if (!a) {
    return colorStart;
  }

  uint32_t reverse = 0xff - a;
  uint32_t r = (((colorStart & 0xff) * reverse) >> 8);
  uint32_t g = ((((colorStart >> 8) & 0xff) * reverse) >> 8) << 8;
  uint32_t b = ((((colorStart >> 16) & 0xff) * reverse) >> 8) << 16;

  // Alpha channel is fixed at 0xFF000000 (opaque)
  return r ^ g ^ b ^ 0xff000000;
}

static inline float powThreeQuarters(float x) {
  float t = sqrtf(x);
  return t * sqrtf(t);
}

static inline uint32_t toRGB(uint32_t r, uint32_t g, uint32_t b) {
  return r ^ (g << 8) ^ (b << 16) ^ 0xff000000;
}

static inline uint32_t getR(uint32_t color) { return color & 0xff; }

static inline uint32_t getG(uint32_t color) { return (color >> 8) & 0xff; }

static inline uint32_t getB(uint32_t color) { return (color >> 16) & 0xff; }

// Fast mixing (smoothing) of 32-bit colors but with consideration for the
// rendering mode
static uint32_t mix2(uint32_t colorStart, uint32_t colorEnd, float a,
                     int renderMode, float darkenAmount) {
  uint32_t color = mix(colorStart, colorEnd, (a * sqrt(a)) * 255);
  return mixBlack(color, 200 * darkenAmount);
}

// Get a smoothed, looped, index of a palette
uint32_t getPalette(float position, uint32_t *palette, int length,
                    int renderMode, float darkenAmount) {
  // Palette used by handlePixels (last element=first element for looping).
  int id = (int)position % length;
  float mod = position - ((int)position / length) * length - (float)id;
  uint32_t color;
  if (renderMode == 1) {
    color = mix(palette[id], palette[id + 1], mod * sqrtf(mod) * 255);
    // Incredibly complicated, with a lot of smoothing and layers going on.
    int newColor = toRGB(45.0f + 0.8f * getR(color), 45.0f + 0.8f * getG(color),
                         45.0f + 0.8f * getB(color));
    if (mod < 0.1f) {
      if (mod < 0.025f) {
        color = mix(color, newColor, mod * 100.0f);
      } else if (mod > 0.075f) {
        color = mix(color, newColor, (0.1f - mod) * 100.0f);
      } else {
        color = newColor;
      }
    } else if (mod > 0.6f) {
      if (mod < 0.7f) {
        if (mod < 0.625f) {
          color = mix(color, newColor, (mod - 0.5f) * 100.0f);
        } else if (mod > 0.675f) {
          color = mix(color, newColor, (0.6f - mod) * 100.0f);
        } else {
          color = newColor;
        }
      } else if (mod > 0.8f && mod <= 0.99f) {
        newColor =
            toRGB(64.0f + 0.75f * getR(color), 64.0f + 0.75f * getG(color),
                  64.0f + 0.75f * getB(color));
        if (mod < 0.825f) {
          color = mix(color, newColor, (mod - 0.8f) * 100.0f);
        } else if (mod > 0.875f) {
          color = mix(color, newColor, (0.9f - mod) * 100.0f);
        } else {
          color = newColor;
        }
      }
      color = mixBlack(color,
                       200.0f - powThreeQuarters(mod > 0.99f
                                                     ? (250.0f * mod - 247.5f)
                                                     : (2.5f * (1.0f - mod))) *
                                    200);
    } else if (mod > 0.2f && mod < 0.3f) {
      if (mod < 0.225f) {
        color = mix(color, newColor, (mod - 0.2f) * 100.0f);
      } else if (mod > 0.275f) {
        color = mix(color, newColor, (0.3f - mod) * 100.0f);
      } else {
        color = newColor;
      }
    } else if (mod > 0.4f && mod < 0.5f) {
      if (mod < 0.425f) {
        color = mix(color, newColor, (mod - 0.4f) * 100.0f);
      } else if (mod > 0.475f) {
        color = mix(color, newColor, (0.5f - mod) * 100.0f);
      } else {
        color = newColor;
      }
    }
  } else if (renderMode == 2) {
    color = mix(palette[id], palette[id + 1], mod * 255.0f);
    float sectionF = mod * 5.0f;
    int section = (int)sectionF;
    float mod2 = sectionF - (int)sectionF;

    if (mod2 > 0.4f) {
      if (mod2 > 0.5f) {
        if (mod2 < 0.95f) {
          color = mixBlack(color, 160.0f * mod2);
        } else {
          color = mixBlack(color, 2500.0f - 2500.0f * mod2);
        }
      } else {
        color = mixBlack(color, 2500.0f * mod2 - 1000.0f);
      }
    }
  } else if (renderMode == 3) {
    uint32_t p1 = palette[id];
    uint32_t p2 = palette[id + 1];
    color = mix(p1, p2, mod * 255.0f);
    float sectionF = mod * 3.0f;
    int section = (int)sectionF;
    float mod2 = sectionF - (int)sectionF;

    if (mod2 > 0.3f && mod2 < 0.7f) {
      if (mod2 < 0.5f) {
        color = mix(color, p1, (mod2 - 0.3f) * 1275.0f);
      } else {
        color = mix(color, p2, (mod2 - 0.5f) * 1275.0f);
      }
    }
  } else {
    color = mix(palette[id], palette[id + 1], mod * 255.0f);
  }
  return mixBlack(color, 200.0f * darkenAmount);
}

// Rather efficient (WASM doesn't support logarithms and a near-accurate
// approximation is okay in this case.)
static inline float flog2(float n) {
  // Use bit_cast to perform the type-pun. This is guaranteed to be safe!
  uint32_t intRepresentation = __builtin_bit_cast(uint32_t, n);

  uint32_t t = (intRepresentation & 0x7fffff) | 0x3f000000;
  float castedFloat = __builtin_bit_cast(float, t);

  float y = intRepresentation; // The integer value is used for scaling
  y *= 1.192092896e-7f;

  return y - 124.2255173f - 1.498030305f * castedFloat -
         1.725880027f / (0.3520887196f + castedFloat);
}

static inline float doubleLogSqrt(float n) {
  // Simpler to create a function for this, as it's used so much
  return flog2(flog2(n) * 0.5);
}

static inline float cosq(float x) {
  x *= 1.5707963267949f;
  x -= 0.25f + floor(x + 0.25f);
  x *= 16.0f * (absD(x) - 0.5f);
  x += 0.225f * x * (absD(x) - 1.0f);
  return x;
}

static inline float sinq(float x) {
  x += 1.5707963267949f;
  x *= 0.1591549430919f;
  x -= 0.25f + floor(x + 0.25f);
  x *= 16.0f * (absD(x) - 0.5f);
  x += 0.225f * x * (absD(x) - 1.0f);
  return x;
}

// All the fractal functions are below! The first section has no shading, the
// second section has directional shading, and the third section does some funky
// weird shading that's a little hard to explain.

float mand(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 2 * r * i + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      // The reason why we have such a high exit value (2000) is because we can
      // use a double logarithm of the absolute distance (sqrt handled inside
      // the doubleLogSqrt function) to make the iterations look smooth.
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float mand3(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = r * (sr - 3.0 * si) + cx;
    i = i * (3.0 * sr - si) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      // There's a magic number here for log3. (I probably didn't need to do
      // this since -O3 would optimize this out to a constant anyway, but it is
      // what it is.)
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      return result;
    }
  }
  return -999.0f;
}

float mand4(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 4.0 * (sr * r * i - r * si * i) +
        cy; // As the powers get higher, you'll notice more weird optimization
            // tactics. sr = real ** 2, fr = real ** 4, same for si and fi.
    r = sr * (sr - 6.0 * si) + si * si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      return result;
    }
  }
  return -999.0f;
}

float mand5(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    i = i * (sr * (5.0 * sr - 10.0 * si) + fi) + cy;
    r = r * (sr * (sr - 10.0 * si) + 5.0 * fi) + cx;
    sr = r * r;
    si = i * i;
    fi = si * si;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.43067655807339306f;
      return result;
    }
  }
  return -999.0f;
}

float mand6(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fr = sr * sr;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    i = r * i * (6.0 * (fr + fi) - 20.0 * sr * si) + cy;
    r = sr * (fr + 15.0 * fi) - si * (15.0 * fr + fi) + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.38685280723454163f;
      return result;
    }
    fr = sr * sr;
    fi = si * si;
  }
  return -999.0f;
}

float mand7(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fr = sr * sr;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    r = r * (fr * (sr - 21.0 * si) + fi * (35.0 * sr - 7.0 * si)) + cx;
    i = i * (fr * (7.0 * sr - 35.0 * si) + fi * (21.0 * sr - si)) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.3562071871080222f;
      return result;
    }
    fr = sr * sr;
    fi = si * si;
  }
  return -999.0f;
}

float ship(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = absD(2.0 * r * i) + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float ship3(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = absD(r) * (sr - 3.0 * si) + cx;
    i = absD(i) * (3.0 * sr - si) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      return result;
    }
  }
  return -999.0f;
}

float ship4(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = absD(4.0 * r * i) * (sr - si) + cy;
    r = sr * sr - 6.0 * sr * si + si * si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      return result;
    }
  }
  return -999.0f;
}

float celt(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 2.0 * r * i + cy;
    r = absD(sr - si) + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float prmb(int iterations, double x, double y, double cx, double cy) {
  double r = absD(x);
  double i = -y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    double tr = 2.0 * r * i;
    r = absD(sr - i * i + cx);
    i = -tr - cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float buff(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = absD(r);
    i = absD(i);
    double tr = 2.0 * r * i;
    r = sr - si - r + cx;
    i = tr - i + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float tric(int iterations, double x, double y, double cx, double cy) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = -2.0 * r * i + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float mbbs(int iterations, double x, double y, double cx, double cy) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      i = absD(2.0 * r * i) + cy;
      r = sr - si + cx;
    } else {
      i = 2.0 * r * i + cy;
      r = sr - si + cx;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float mbbs3(int iterations, double x, double y, double cx, double cy) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      r = absD(r) * (sr - 3.0 * si) + cx;
      i = absD(i) * (3.0 * sr - si) + cy;
    } else {
      r = r * (sr - 3.0 * si) + cx;
      i = i * (3.0 * sr - si) + cy;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      return result;
    }
  }
  return -999.0f;
}

float mbbs4(int iterations, double x, double y, double cx, double cy) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      i = absD(4.0 * r * i) * (sr - si) + cy;
      r = sr * sr - 6.0 * sr * si + si * si + cx;
    } else {
      i = 4.0 * (sr * r * i - r * si * i) + cy;
      r = sr * (sr - 6.0 * si) + si * si + cx;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      return result;
    }
  }
  return -999.0f;
}

// -----

float mandS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    double tempdr = 2.0 * (dr * r - di * i) + 1.0;
    di = 2.0 * (dr * i + di * r);
    dr = tempdr;
    i = 2 * r * i + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand3S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    double temp = 2.0 * r * i;
    double tempdr = 3.0 * (dr * (sr - si) - di * temp) + 1.0;
    di = 3.0 * (dr * temp + di * (sr - si));
    dr = tempdr;
    r = r * (sr - 3.0 * si) + cx;
    i = i * (3.0 * sr - si) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand4S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    // Calculate the derivative for 4th power
    double temp = r * i;
    double tempdr = 4.0 * (sr - si) * (dr * r - di * i) -
                    8.0 * temp * (dr * i + di * r) + 1.0;
    di = 4.0 * (sr - si) * (dr * i + di * r) + 8.0 * temp * (dr * r - di * i);
    dr = tempdr;
    i = 4.0 * (sr * temp - r * si * i) + cy;
    r = sr * (sr - 6.0 * si) + si * si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand5S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fi = si * si;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    double tempdr = 5.0 * (sr * sr - 6 * sr * si + fi) * dr -
                    20 * r * i * (sr - si) * di + 1.0;
    di = 5.0 * (sr * sr - 6 * sr * si + fi) * di + 20 * r * i * (sr - si) * dr;
    dr = tempdr;
    i = i * (sr * (5.0 * sr - 10.0 * si) + fi) + cy;
    r = r * (sr * (sr - 10.0 * si) + 5.0 * fi) + cx;
    sr = r * r;
    si = i * i;
    fi = si * si;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.43067655807339306f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand6S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fr = sr * sr;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    i = r * i * (6.0 * (fr + fi) - 20.0 * sr * si) + cy;
    r = sr * (fr + 15.0 * fi) - si * (15.0 * fr + fi) + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.38685280723454163f;
      return result;
    }
    fr = sr * sr;
    fi = si * si;
  }
  return -999.0f;
}

float mand7S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fr = sr * sr;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    r = r * (fr * (sr - 21.0 * si) + fi * (35.0 * sr - 7.0 * si)) + cx;
    i = i * (fr * (7.0 * sr - 35.0 * si) + fi * (21.0 * sr - si)) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.3562071871080222f;
      return result;
    }
    fr = sr * sr;
    fi = si * si;
  }
  return -999.0f;
}

float shipS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    double tempdr = 2.0 * (dr * r - di * i) + 1.0;
    di = 2.0 * (dr * i + di * r);
    dr = tempdr;
    i = absD(2.0 * r * i) + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float ship3S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    double temp = 2.0 * r * i;
    double tempdr = 3.0 * (dr * (sr - si) - di * temp) + 1.0;
    di = 3.0 * (dr * temp + di * (sr - si));
    dr = tempdr;
    r = absD(r) * (sr - 3.0 * si) + cx;
    i = absD(i) * (3.0 * sr - si) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float ship4S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    double temp = r * i;
    double tempdr = 4.0 * (sr - si) * (dr * r - di * i) -
                    8.0 * temp * (dr * i + di * r) + 1.0;
    di = 4.0 * (sr - si) * (dr * i + di * r) + 8.0 * temp * (dr * r - di * i);
    dr = tempdr;
    i = absD(4.0 * r * i) * (sr - si) + cy;
    r = sr * sr - 6.0 * sr * si + si * si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float celtS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 2.0 * r * i + cy;
    r = absD(sr - si) + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float prmbS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  double r = absD(x);
  double i = -y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    double tr = 2.0 * r * i;
    r = absD(sr - i * i + x);
    i = -tr - y;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float buffS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = absD(r);
    i = absD(i);
    double tr = 2.0 * r * i;
    r = sr - si - r + cx;
    i = tr - i + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float tricS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = -2.0 * r * i + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float mbbsS(int iterations, double x, double y, double cx, double cy,
            float *ptr) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      i = absD(2.0 * r * i) + cy;
      r = sr - si + cx;
    } else {
      i = 2.0 * r * i + cy;
      r = sr - si + cx;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      return result;
    }
  }
  return -999.0f;
}

float mbbs3S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      r = absD(r) * (sr - 3.0 * si) + cx;
      i = absD(i) * (3.0 * sr - si) + cy;
    } else {
      r = r * (sr - 3.0 * si) + cx;
      i = i * (3.0 * sr - si) + cy;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      return result;
    }
  }
  return -999.0f;
}

float mbbs4S(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      i = absD(4.0 * r * i) * (sr - si) + cy;
      r = sr * sr - 6.0 * sr * si + si * si + cx;
    } else {
      i = 4.0 * (sr * r * i - r * si * i) + cy;
      r = sr * (sr - 6.0 * si) + si * si + cx;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      return result;
    }
  }
  return -999.0f;
}

// -----

float mandS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 2 * r * i + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand3S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = r * (sr - 3.0 * si) + cx;
    i = i * (3.0 * sr - si) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand4S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 4.0 * (sr * r * i - r * si * i) + cy;
    r = sr * (sr - 6.0 * si) + si * si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand5S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    i = i * (sr * (5.0 * sr - 10.0 * si) + fi) + cy;
    r = r * (sr * (sr - 10.0 * si) + 5.0 * fi) + cx;
    sr = r * r;
    si = i * i;
    fi = si * si;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.43067655807339306f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mand6S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fr = sr * sr;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    i = r * i * (6.0 * (fr + fi) - 20.0 * sr * si) + cy;
    r = sr * (fr + 15.0 * fi) - si * (15.0 * fr + fi) + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.38685280723454163f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
    fr = sr * sr;
    fi = si * si;
  }
  return -999.0f;
}

float mand7S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double fr = sr * sr;
  double fi = si * si;
  for (int n = 1; n <= iterations; n++) {
    r = r * (fr * (sr - 21.0 * si) + fi * (35.0 * sr - 7.0 * si)) + cx;
    i = i * (fr * (7.0 * sr - 35.0 * si) + fi * (21.0 * sr - si)) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.3562071871080222f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
    fr = sr * sr;
    fi = si * si;
  }
  return -999.0f;
}

float shipS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  double dr = 1;
  double di = 0;
  for (int n = 1; n <= iterations; n++) {
    i = absD(2.0 * r * i) + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float ship3S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = absD(r) * (sr - 3.0 * si) + cx;
    i = absD(i) * (3.0 * sr - si) + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float ship4S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = absD(4.0 * r * i) * (sr - si) + cy;
    r = sr * sr - 6.0 * sr * si + si * si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float celtS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = 2.0 * r * i + cy;
    r = absD(sr - si) + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float prmbS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = absD(x);
  double i = -y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    double tr = 2.0 * r * i;
    r = absD(sr - i * i + x);
    i = -tr - y;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float buffS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    r = absD(r);
    i = absD(i);
    double tr = 2.0 * r * i;
    r = sr - si - r + cx;
    i = tr - i + cy;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float tricS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    i = -2.0 * r * i + cy;
    r = sr - si + cx;
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mbbsS2(int iterations, double x, double y, double cx, double cy,
             float *ptr) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      i = absD(2.0 * r * i) + cy;
      r = sr - si + cx;
    } else {
      i = 2.0 * r * i + cy;
      r = sr - si + cx;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mbbs3S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      r = absD(r) * (sr - 3.0 * si) + cx;
      i = absD(i) * (3.0 * sr - si) + cy;
    } else {
      r = r * (sr - 3.0 * si) + cx;
      i = i * (3.0 * sr - si) + cy;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.6309297535714575f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

float mbbs4S2(int iterations, double x, double y, double cx, double cy,
              float *ptr) {
  int exchange = 1;
  double r = x;
  double i = y;
  double sr = r * r;
  double si = i * i;
  for (int n = 1; n <= iterations; n++) {
    if (exchange++ == 10) {
      exchange = 1;
      i = absD(4.0 * r * i) * (sr - si) + cy;
      r = sr * sr - 6.0 * sr * si + si * si + cx;
    } else {
      i = 4.0 * (sr * r * i - r * si * i) + cy;
      r = sr * (sr - 6.0 * si) + si * si + cx;
    }
    sr = r * r;
    si = i * i;
    if (unlikely(sr + si > BAILOUT_VALUE)) {
      float result = (float)n - (doubleLogSqrt(sr + si)) * 0.5f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = fmaxf(0.0f, t) * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

// Keep C export names
extern "C" {
// Simply renders the output; no fuss.
void render(int pixels, int paletteLen, uint32_t interiorColor, int renderMode,
            int darkenEffect, float speed, float flowAmount) {
  // "What is the current pixel we are working on?"
  // `pixelAtomic` is the atomic counter for chunks, located at
  // `Mem::AtomicCounter`.
  int *pixelAtomic = reinterpret_cast<int *>(Mem::AtomicCounter);

  // `iters` points to the start of the iteration data in `Mem::PixelDataStart`.
  float *iters = reinterpret_cast<float *>(Mem::PixelDataStart);
  // `shading` data immediately follows `iters` data in memory.
  float *shading = iters + pixels;
  // `colors` (RGBA data) immediately follows `shading` data in memory.
  uint32_t *colors = reinterpret_cast<uint32_t *>(shading + pixels);
  // `palette` data is located at `Mem::PaletteData`.
  uint32_t *palette = reinterpret_cast<uint32_t *>(Mem::PaletteData);

  const float speed1 = sqrtf(sqrtf(speed));
  const float speed2 = 0.035f * speed;
  const int totalChunks = (pixels + RENDER_CHUNK_SIZE - 1) / RENDER_CHUNK_SIZE;

  // This is the robust, thread-safe loop structure.
  while (true) {
    // Use the compiler built-in for the atomic operation.
    // #ifdef __EMSCRIPTEN_PTHREADS__
    int chunkIndex = __atomic_fetch_add(pixelAtomic, 1, __ATOMIC_RELAXED);
    // #else
    //     int chunkIndex = (*pixelAtomic)++;
    // #endif
    if (unlikely(chunkIndex >= totalChunks)) {
      break;
    }

    const int start = chunkIndex * RENDER_CHUNK_SIZE;
    const int end = std::min(start + RENDER_CHUNK_SIZE, pixels);

    for (int i = start; i < end; ++i) {
      float t = iters[i];

      // This is your original, correct coloring logic.
      if (t == -999.0f) {
        colors[i] = interiorColor;
      } else if (t == 1.0f) {
        int index = flowAmount;
        int indexModulo = index % paletteLen;
        float l = shading[i]; // Correctly read from the shading buffer
        colors[i] = mix2(palette[indexModulo], palette[indexModulo + 1],
                         flowAmount - index, renderMode,
                         darkenEffect == 2 ? 1.0f - l : l);
      } else {
        float l = shading[i]; // Correctly read from the shading buffer
        colors[i] = getPalette(
            flog2(t) * speed1 + (t - 1) * speed2 + flowAmount, palette,
            paletteLen, renderMode, darkenEffect == 2 ? 1.0f - l : l);
      }
    }
  }
}

/**
 * @brief This is the main function! It renders a fractal image to a pixel
 * buffer using multithreading. Iterates through pixels, calculates fractal
 * values, and adds pixel data. Make sure to also read the JS code to understand
 * constants/inputs!
 *
 * @param type          [in]  int             Fractal type (1 is Mandelbrot,
 * negative means Julia set)
 * @param w             [in]  int             Image width in pixels
 * @param h             [in]  int             Image height in pixels
 * @param posX          [in]  double          Horizontal position of the
 * fractal.
 * @param posY          [in]  double          Vertical position of the fractal
 * @param zoom          [in]  double          Zoom level of the fractal
 * @param max           [in]  int             Maximum calculation 'score' before
 * early exit.
 * @param iterations    [in]  int             Maximum iterations per pixel
 * @param paletteLen    [in]  int             Total length of the color palette
 * @param interiorColor [in]  uint32_t        Color for pixels that do not
 * escape.
 * @param renderMode    [in]  int             Rendering mode for palette
 * application.
 * @param darkenEffect  [in]  int             Darkening/shading effect mode
 * @param speed         [in]  float           Palette color cycling speed
 * @param flowAmount    [in]  float           Palette flow/pan amount
 * @param data1         [in]  double          Additional data (Julia X)
 * @param data2         [in]  double          Additional data (Julia Y)
 *
 * @return              int             -1 for completion, pixel index if not
 * fully completed.
 */
int run(int type, int w, int h, double posX, double posY, double zoom, int max,
        int iterations, int paletteLen, uint32_t interiorColor, int renderMode,
        int darkenEffect, float speed, float flowAmount, double data1,
        double data2) {
  // "What is the current pixel we are working on?"
  int *pixelAtomic = reinterpret_cast<int *>(Mem::AtomicCounter);
  // Total pixels to work on
  const int pixels = w * h;

  // "What is the memory address of the data for the palette of colors to use?"
  uint32_t *palette = reinterpret_cast<uint32_t *>(Mem::PaletteData);
  // "What is the memory address of the data for iterations before exiting?"
  float *iters = reinterpret_cast<float *>(Mem::PixelDataStart);
  // "What is the memory address of the data for shading?"
  float *shading = iters + pixels;
  // "What is the memory address of the RGBA data for rendering?"
  uint32_t *colors = reinterpret_cast<uint32_t *>(shading + pixels);

  const float speed1 = sqrtf(sqrtf(speed));
  const float speed2 = 0.035f * speed;
  int score = 0;

  // Capture the job ID at the start. This worker is now locked to this job.
  const int biggerIterations = iterations + 2;
  const int totalChunks = (pixels + CALC_CHUNK_SIZE - 1) / CALC_CHUNK_SIZE;

  // Find the absolute value
  int absType = (type < 0) ? -type : type;
  const bool isJulia = (type < 0);

  // This is the main worker loop. It is pixel-based for best load balancing.
  while (true) {
    // #ifdef __EMSCRIPTEN_PTHREADS__
    int i = __atomic_fetch_add(pixelAtomic, CALC_CHUNK_SIZE, __ATOMIC_RELAXED);
    // #else
    //     int i = *pixelAtomic;
    //     *pixelAtomic += CALC_CHUNK_SIZE;
    // #endif

    const int startPixel = i;
    const int endPixel = std::min(startPixel + CALC_CHUNK_SIZE, pixels);

    // Optimized coordinate calculation setup
    for (int t = startPixel; t < endPixel; ++t) {
      if (iters[t] == 0.0f) {
        const double x = t % w;
        const double y = t / w;
        const double coordinateX = posX + x * zoom;
        const double coordinateY = posY + y * zoom;

        const double coordinateX2 = isJulia ? data1 : coordinateX;
        const double coordinateY2 = isJulia ? data2 : coordinateY;

        // Correctly get the pointer to the shading data for the CURRENT pixel
        float *ptr = shading + t;
        float n;

        // Run the function needed and also look at the darken effect
        switch (darkenEffect) {
        case 0:
          switch (absType) {
          case 1:
            n = mand(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 2:
            n = mand3(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 3:
            n = mand4(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 4:
            n = mand5(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 5:
            n = mand6(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 6:
            n = mand7(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 7:
            n = ship(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 8:
            n = ship3(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 9:
            n = ship4(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 10:
            n = celt(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 11:
            n = prmb(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 12:
            n = buff(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 13:
            n = tric(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 14:
            n = mbbs(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 15:
            n = mbbs3(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 16:
            n = mbbs4(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
          }
          break;
        case 3:
          switch (absType) {
          case 1:
            n = mandS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 2:
            n = mand3S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 3:
            n = mand4S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 4:
            n = mand5S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 5:
            n = mand6S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 6:
            n = mand7S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 7:
            n = shipS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 8:
            n = ship3S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 9:
            n = ship4S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 10:
            n = celtS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 11:
            n = prmbS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 12:
            n = buffS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 13:
            n = tricS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 14:
            n = mbbsS2(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 15:
            n = mbbs3S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
            break;
          case 16:
            n = mbbs4S2(iterations, coordinateX, coordinateY, coordinateX2,
                        coordinateY2, ptr);
          }
          break;
        default:
          switch (absType) {
          case 1:
            n = mandS(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2, ptr);
            break;
          case 2:
            n = mand3S(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 3:
            n = mand4S(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 4:
            n = mand5S(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 5:
            n = mand6(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 6:
            n = mand7(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 7:
            n = shipS(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2, ptr);
            break;
          case 8:
            n = ship3S(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 9:
            n = ship4S(iterations, coordinateX, coordinateY, coordinateX2,
                       coordinateY2, ptr);
            break;
          case 10:
            n = celt(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 11:
            n = prmb(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 12:
            n = buff(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 13:
            n = tric(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 14:
            n = mbbs(iterations, coordinateX, coordinateY, coordinateX2,
                     coordinateY2);
            break;
          case 15:
            n = mbbs3(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
            break;
          case 16:
            n = mbbs4(iterations, coordinateX, coordinateY, coordinateX2,
                      coordinateY2);
          }
        }

        // Store results and update the score.
        iters[t] = n;
        if (n == -999.0f) {
          score += biggerIterations;
        } else {
          score += 12 + (int)n;
        }
      }

      // This runs for every pixel to handle panning, interior and edge cases
      // correctly.
      const float n = iters[t];
      if (unlikely(n == -999.0f)) {
        colors[t] = interiorColor;
      } else {
        const float l = shading[t];
        const float final_darken = (darkenEffect == 2) ? (1.0f - l) : l;

        if (unlikely(n < 1.000004f)) { // Slightly above 1 due to our log2()
                                       // estimation beeing goofy
          iters[t] = 1.0f;
          int index = static_cast<int>(flowAmount);
          int indexModulo = index % paletteLen;
          colors[t] = mix2(palette[indexModulo], palette[indexModulo + 1],
                           flowAmount - index, renderMode, final_darken);
        } else {
          colors[t] =
              getPalette(flog2(n) * speed1 + (n - 1.0f) * speed2 + flowAmount,
                         palette, paletteLen, renderMode, final_darken);
        }
      }
    }
    if (unlikely(i >= pixels)) {
      return -1; // All chunks have been claimed, this worker is done.
    } else if (unlikely(score >= max)) {
      return endPixel == pixels ? -1 : endPixel;
    }
  }
}
}