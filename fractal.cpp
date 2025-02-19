/*
Welcome to my code that helps run my fractal viewer. All the code is licensed
under GNU Affero General Public License v3. and is open source in case you want
to use it! It is compiled into WASM, and the exported functions can then be
executed by JavaScript.
*/

#include <stdint.h>

#include <atomic>
#include <new>

// We don't need to include math.h if we add these functions.
float sqrtf(float x);
double sqrt(double x);
double floor(double x);

#define sqrtf __builtin_sqrtf
#define sqrt __builtin_sqrt
#define floor __builtin_floor

static inline double absD(double x) { return (x < 0.0) ? -x : x; }

// Fast mixing (smoothing) of 32-bit colors
static inline uint32_t mix(uint32_t colorStart, uint32_t colorEnd, uint32_t a) {
  uint32_t reverse = 0xff - a;
  return ((((colorStart & 0xff) * reverse + (colorEnd & 0xff) * a) >> 8)) ^
         (((((colorStart >> 8) & 0xff) * reverse +
            ((colorEnd >> 8) & 0xff) * a)) &
          -0xff) ^
         (((((colorStart >> 16) & 0xff) * reverse +
            ((colorEnd >> 16) & 0xff) * a)
           << 8) &
          -0xffff) ^
         0xff000000;
}

static inline float powThreeQuarters(float x) {
  float t = sqrtf(x);
  return t * sqrtf(t);
}

static inline uint32_t mixBlack(uint32_t colorStart, uint32_t a) {
  if (!a) return colorStart;
  uint32_t reverse = 0xff - a;
  return ((((colorStart & 0xff) * reverse) >> 8)) ^
         (((((colorStart >> 8) & 0xff) * reverse)) & -0xff) ^
         (((((colorStart >> 16) & 0xff) * reverse) << 8) & -0xffff) ^
         0xff000000;
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
  if (renderMode == 0) {
    uint32_t color = mix(colorStart, colorEnd, a * darkenAmount * 255);
  }
  uint32_t color = mix(colorStart, colorEnd, (a * sqrt(a)) * 255);
  return mixBlack(color, 200 * darkenAmount);
}

// Get a smoothed, looped, index of a pallete
uint32_t getPallete(float position, uint32_t *pallete, int length,
                    int renderMode, float darkenAmount) {
  // Pallete used by handlePixels (last element=first element for looping).
  // Interestingly, you can get the hex representations with the middle six
  // letters (#a00a0a for the first one, for example)
  int id = (int)position % length;
  float mod = position - ((int)position / length) * length - (float)id;
  uint32_t color;
  if (renderMode == 1) {
    color = mix(pallete[id], pallete[id + 1], mod * sqrtf(mod) * 255);
    // Incredibly complicated, right?
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
      color = mixBlack(
          color,
          200.0f - powThreeQuarters(mod > 0.99f ? (250.0f * mod - 247.5f)
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
    color = mix(pallete[id], pallete[id + 1], mod * 255.0f);
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
    uint32_t p1 = pallete[id];
    uint32_t p2 = pallete[id + 1];
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
    color = mix(pallete[id], pallete[id + 1], mod * 255.0f);
  }
  return mixBlack(color, 200.0f * darkenAmount);
}

// Really efficient (wouldn't be used if WASM supported logarithms; reduces
// overhead)
static inline float flog2(float n) {
  union {
    float number;
    uint32_t integer;
  } firstUnion = {n};
  union {
    uint32_t integer;
    float number;
  } secondUnion = {(firstUnion.integer & 0x7fffff) | 0x3f000000};
  float y = firstUnion.integer;
  y *= 1.19209289e-7f;

  return y - 124.225517f - 1.4980303f * secondUnion.number -
         1.72588f / (0.35208873f + secondUnion.number);
}

static inline float secondLog(float n) {
  // Simpler to create a function for this, as it's used so much
  return flog2(flog2(n));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
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
    i = 4.0 * (sr * r * i - r * si * i) + cy;
    r = sr * (sr - 6.0 * si) + si * si + cx;
    sr = r * r;
    si = i * i;
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.43067655807339306f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.38685280723454163f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.3562071871080222f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.43067655807339306f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.38685280723454163f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.3562071871080222f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
      double sqm = dr * dr + di * di;
      double ur = (r * dr + i * di) / sqm;
      double ui = (i * dr - r * di) / sqm;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : (t * 0.4f);
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.43067655807339306f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.38685280723454163f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.3562071871080222f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si)));
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result =
          (float)n - (secondLog(sqrtf(sr + si))) * 0.6309297535714575f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
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
    if (sr + si > 2000.0) {
      float result = (float)n - (secondLog(sqrtf(sr + si))) * 0.5f;
      double ur = r + i;
      double ui = i - r;
      double norm = sqrt(ur * ur + ui * ui);
      ur /= norm;
      ui /= norm;
      float t = (ur + ui) * 0.7071067811865475f + 1.5f;
      *ptr = t <= 0 ? 0 : t * 0.4f;
      return result;
    }
  }
  return -999.0f;
}

// Keep C export names
extern "C" {
// Simply renders the output; no fuss.
extern void render(int limit, int *pixelP, float *iters, uint32_t *colors,
                   uint32_t *pallete, int palleteLength, uint32_t interiorColor,
                   int renderMode, int darkenEffect, float speed,
                   float flowAmount) {
  void *pixelP_void = static_cast<void *>(pixelP);
  std::atomic<int> *pixelAtomic = new (pixelP_void) std::atomic<int>(*pixelP);
  float *itersPtr = iters;
  float speed1 = sqrtf(sqrtf(speed));
  float speed2 = 0.035f * speed;
  int finalChunk = (limit >> 12) - 1;
  do {
    // Use chunks of 4,096 pixels
    int i = pixelAtomic->fetch_add(1, std::memory_order_relaxed);
    int current = 4096 * i;
    int cap = current + 4096;
    if (i >= finalChunk) {
      if (i == finalChunk) {
        cap = limit - 1;
      } else {
        break;
      }
    }
    do {
      float *ptr = itersPtr + limit + current;
      float t = iters[current];
      if (t == -999.0f) {
        colors[current] = interiorColor;
      } else if (t == 1.0f) {
        int index = flowAmount;
        int indexModulo = index % palleteLength;
        float l = *ptr;
        colors[current] = mix2(pallete[indexModulo], pallete[indexModulo + 1],
                               flowAmount - index, renderMode,
                               darkenEffect == 2 ? 1.0f - l : l);
      } else {
        float l = *ptr;
        colors[current] = getPallete(
            flog2(t) * speed1 + (t - 1) * speed2 + flowAmount, pallete,
            palleteLength, renderMode, darkenEffect == 2 ? 1.0f - l : l);
      }
    } while (++current != cap);
  } while (pixelAtomic->load(std::memory_order_relaxed) < finalChunk);
}

/**
 * @brief Renders a fractal image to a pixel buffer using multithreading.
 * Iterates through pixels, calculates fractal values, and colors pixels based
 * on parameters.
 * Make sure to also read the JS code to understand all this!
 *
 * @param type          [in]  int             Fractal type (0=Mandelbrot)
 * @param w             [in]  int             Image width in pixels
 * @param h             [in]  int             Image height in pixels
 * @param pixelP        [in,out] int*          Pixel buffer (reinterpreted as
 atomic for threads).
 * @param posX          [in]  double          Horizontal position of the
 fractal.
 * @param posY          [in]  double          Vertical position of the fractal
 * @param zoom          [in]  double          Zoom level of the fractal
 * @param max           [in]  int             Maximum calculation 'score' before
 * early exit.
 * @param iters         [in,out] float*        Iteration counts buffer
 * (pre-calculated or output).
 * @param colors        [out] uint32_t*       Output color buffer (RGBA)
 * @param iterations    [in]  int             Maximum iterations per fractal
 * point.
 * @param pallete       [in]  uint32_t*       Color palette array pointer
 * @param palleteLength [in]  int             Length of the color palette
 * @param interiorColor [in]  uint32_t        Color for pixels that do not
 escape.
 * @param renderMode    [in]  int             Rendering mode for palette
 * application.
 * @param darkenEffect  [in]  int             Darkening/shading effect mode
 * @param speed         [in]  float           Palette color cycling speed
 * @param flowAmount    [in]  float           Palette flow/pan amount
 * @param data1         [in]  double          Additional data
 * @param data2         [in]  double          Additional data
 *
 * @return              int             -1 for completion, pixel index if not
 fully completed.
 */
extern int run(int type, int w, int h, int *pixelP, double posX, double posY,
               double zoom, int max, float *iters, uint32_t *colors,
               int iterations, uint32_t *pallete, int palleteLength,
               uint32_t interiorColor, int renderMode, int darkenEffect,
               float speed, float flowAmount, double data1, double data2) {
  // The boring stuff is here! We use 32-bit RGBA uint32_t instead of 8-bit
  // numbers for the coloring, because it's simpler and doesn't slow down JS at
  // all (we can access it with Uint8ClampedArray)

  void *pixelP_void = static_cast<void *>(pixelP);
  std::atomic<int> *pixelAtomic = new (pixelP_void) std::atomic<int>(*pixelP);
  int score = 0;
  int limit = w * h;
  int biggerIterations = iterations + 2;

  // Find the absolute value
  int absType = type;
  uint32_t temp = absType >> 31;
  absType ^= temp;
  absType += temp & 1;

  // Pre-calculate speed constants for faster renderings
  float speed1 = sqrtf(sqrtf(speed));
  float speed2 = 0.035f * speed;
  float *itersPtr = iters;

  double coordinateX2 = data1;
  double coordinateY2 = data2;

  // This uses a do...while rather than a simple while, so it doesn't increment
  // the first time.
  do {
    int i = pixelAtomic->fetch_add(1, std::memory_order_relaxed);
    if (i >= limit) {
      break;  // important safety check
    }
    double x = i % w;
    double y = i / w;
    float t = iters[i];
    float *ptr = itersPtr + limit + i;
    if (t) {
      if (t == -999.0f) {
        colors[i] = interiorColor;
      } else if (t == 1.0f) {
        int index = flowAmount;
        int indexModulo = index % palleteLength;
        float l = *ptr;
        colors[i] = mix2(pallete[indexModulo], pallete[indexModulo + 1],
                         flowAmount - index, renderMode,
                         darkenEffect == 2 ? 1.0f - l : l);
      } else {
        float l = *ptr;
        colors[i] = getPallete(
            flog2(t) * speed1 + (t - 1) * speed2 + flowAmount, pallete,
            palleteLength, renderMode, darkenEffect == 2 ? 1.0f - l : l);
      }
      continue;
    }
    double coordinateX = posX + x * zoom;
    double coordinateY = posY + y * zoom;
    if (absType == type) {  // If not needing to render a julia set
      coordinateX2 = coordinateX;
      coordinateY2 = coordinateY;
    }

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
    // Cost increases are pre-computed to be as stable as possible (at least for
    // my computer)
    if (n == -999.0f) {
      score += biggerIterations;
      colors[i] = interiorColor;
      iters[i] = -999.0;
    }
    // Why a tad more than 1? If flog2() has a value less than this, it gives a
    // negative number, which will cause problems.
    else if (n < 1.000004f) {
      int index = flowAmount;
      int indexModulo = index % palleteLength;
      float l = *ptr;
      colors[i] = mix2(pallete[indexModulo], pallete[indexModulo + 1],
                       flowAmount - index, renderMode,
                       darkenEffect == 2 ? 1.0f - l : l);
      iters[i] = 1.0f;
    } else {
      score += 13 + (int)n;
      float l = *ptr;
      colors[i] = getPallete(flog2(n) * speed1 + (n - 1) * speed2 + flowAmount,
                             pallete, palleteLength, renderMode,
                             darkenEffect == 2 ? 1.0f - l : l);
      iters[i] = n;
    }
    if (score >= max) {
      return i;
    }
  } while (pixelAtomic->load(std::memory_order_relaxed) < limit);
  // Tell the script that it has completed!
  return -1;
}
}