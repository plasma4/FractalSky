#include <stdint.h> // For uint64_t, uint8_t

// Define constants for the number format: there are 16 Decimal memory regions
// after palette data.
#define POSITIVE 0
#define NEGATIVE 1
#define FRACTIONAL_SIZE 30
// Total chunk size = 32: 1x sign, 1x integer, 30x fractional
#define CHUNK_SIZE (FRACTIONAL_SIZE + 2)

#define i128 __int128
#define fill __builtin_memset
#define memcpy __builtin_memcpy

extern "C" {
// Inlined sign read/write - using uint64_t now for consistency
static inline void writeSign(uint64_t *loc, int64_t sign) {
  loc[0] = sign; // Sign is stored in the first uint64_t element
}

static inline void clearValue(uint64_t *valueBuffer) {
  __builtin_memcpy(valueBuffer, valueBuffer + FRACTIONAL_SIZE, 0);
}

/**
 * @brief Determines if |a| >= |b|.
 * @param a Pointer to the first number.
 * @param b Pointer to the second number.
 * @return Boolean result.
 */
static inline int isGte(const uint64_t *a, const uint64_t *b) {
  // Compare from the most significant part (integer) to the least significant.
  for (int i = 1; i < CHUNK_SIZE; ++i) {
    if (a[i] > b[i])
      return true;
    if (a[i] < b[i])
      return false;
  }
  return true; // Magnitudes are equal.
}

/**
 * @brief Adds the magnitudes of two numbers, ignoring their signs.
 * @note Result may be incorrect if 'output' aliases 'value1' or 'value2'.
 *       A temporary buffer is used to ensure correctness.
 * @param value1 Pointer to the first number.
 * @param value2 Pointer to the second number.
 * @param output Pointer to store the result.
 */
static inline void rawAdd(const uint64_t *value1, const uint64_t *value2,
                          uint64_t *output) {
  uint64_t carry = 0;
  // Add fractional parts from least to most significant, propagating carry.
  for (int i = CHUNK_SIZE - 1; i >= 2; --i) {
    uint64_t sum = value1[i] + value2[i] + carry;
    // Carry is 1 if the sum wrapped around (is less than one of the addends).
    carry = (sum < value1[i]) || (carry && sum == value1[i]) ? 1 : 0;
    output[i] = sum;
  }

  // Add the integer part with the final carry from the fractional part.
  output[1] = value1[1] + value2[1] + carry;
}

/**
 * @brief Subtracts the magnitude of a smaller number from a larger one.
 * @note Assumes |value1| >= |value2|. The result is always positive.
 * @param value1 Pointer to the minuend (larger number).
 * @param value2 Pointer to the subtrahend (smaller number).
 * @param output Pointer to store the result.
 */
static inline void rawSubtract(const uint64_t *value1, const uint64_t *value2,
                               uint64_t *output) {
  int64_t borrow = 0;
  // Subtract fractional parts from least to most significant, propagating
  // borrow.
  for (int i = CHUNK_SIZE - 1; i >= 2; --i) {
    unsigned i128 diff = (unsigned i128)value1[i] - value2[i] - borrow;
    output[i] = (uint64_t)diff;
    // Borrow is 1 if the subtraction underflowed.
    borrow = (diff >> 64) & 1;
  }

  // Subtract the integer part with the final borrow.
  output[1] = value1[1] - value2[1] - borrow;
}

/**
 * @brief Multiplies an integer part by a fractional part.
 * @param output The buffer to store the full resulting number (sign is not
 * set).
 * @param integer The integer value multiplier.
 * @param fraction The fractional part multiplier.
 */
static inline void multiply_int_frac(uint64_t *output, uint64_t integer,
                                     const uint64_t *fraction) {
  fill(output, 0, CHUNK_SIZE * sizeof(uint64_t));
  unsigned i128 carry = 0;

  // Multiply each fractional limb by the integer, propagating the carry.
  for (int i = FRACTIONAL_SIZE - 1; i >= 0; --i) {
    unsigned i128 product = (unsigned i128)integer * fraction[i] + carry;
    output[i + 2] = (uint64_t)product; // Store the low 64 bits.
    carry = product >> 64;             // High 64 bits are the new carry.
  }
  output[1] = (uint64_t)carry; // The final carry becomes the integer part.
}

/**
 * @brief Multiplies two fractional parts together.
 * @param output The buffer to store the full resulting number (sign is not
 * set).
 * @param fraction1 The first fractional multiplier.
 * @param fraction2 The second fractional multiplier.
 */
static inline void multiply_frac_frac(uint64_t *output,
                                      const uint64_t *fraction1,
                                      const uint64_t *fraction2) {
  // Use a temporary 128-bit buffer for the full 2N-limb product to prevent
  // overflow.
  unsigned i128 full_product[2 * FRACTIONAL_SIZE] = {0};
  fill(output, 0, CHUNK_SIZE * sizeof(uint64_t));

  // Standard schoolbook multiplication.
  for (int i = 0; i < FRACTIONAL_SIZE; ++i) {
    for (int j = 0; j < FRACTIONAL_SIZE; ++j) {
      // The product of two limbs at f[i] and f[j] contributes to the result at
      // position i+j. +1 because a fraction starts at f[0] = 2^-64, so
      // f[i]*f[j] = 2^(-64(i+j+2)). The result index in full_product
      // corresponds to 2^(-64*(index+1)).
      full_product[i + j + 1] += (unsigned i128)fraction1[i] * fraction2[j];
    }
  }

  // Propagate carries through the full product from LSB to MSB.
  for (int i = 2 * FRACTIONAL_SIZE - 1; i > 0; --i) {
    full_product[i - 1] += full_product[i] >> 64;
    full_product[i] = (uint64_t)full_product[i]; // Truncate to 64 bits.
  }

  // The carry-out of the most significant fractional limb is the integer part
  // of the product.
  output[1] = (uint64_t)(full_product[0] >> 64);

  // Copy the most significant N fractional limbs to the output buffer.
  for (int i = 0; i < FRACTIONAL_SIZE; ++i) {
    output[i + 2] = (uint64_t)full_product[i];
  }
}

/**
 * @brief Adds two fixed-point numbers.
 * @param value1 Pointer to the first operand.
 * @param value2 Pointer to the second operand.
 * @param output Pointer to store the result. Can be the same as an input.
 */
void add(const uint64_t *value1, const uint64_t *value2, uint64_t *output) {
  const uint64_t sign1 = value1[0];
  const uint64_t sign2 = value2[0];

  // Use a temporary buffer to handle cases where output aliases an input.
  uint64_t temp_result[CHUNK_SIZE];

  if (sign1 == sign2) {
    // Same signs (e.g., 5 + 2 or -5 + -2): Add magnitudes, keep sign.
    rawAdd(value1, value2, temp_result);
    temp_result[0] = sign1;
  } else {
    // Different signs (e.g., 5 + -2 or -5 + 2): Subtract smaller magnitude from
    // larger.
    if (isGte(value1, value2)) {
      // |value1| >= |value2|. Result is |value1| - |value2| with sign of
      // value1.
      rawSubtract(value1, value2, temp_result);
      temp_result[0] = sign1;
    } else {
      // |value2| > |value1|. Result is |value2| - |value1| with sign of value2.
      rawSubtract(value2, value1, temp_result);
      temp_result[0] = sign2;
    }
  }
  memcpy(output, temp_result, CHUNK_SIZE * sizeof(uint64_t));
}

/**
 * @brief Multiplies two fixed-point numbers.
 * @param value1 Pointer to the first operand.
 * @param value2 Pointer to the second operand.
 * @param output Pointer to store the result. Can be the same as an input.
 */
void multiply(const uint64_t *value1, const uint64_t *value2,
              uint64_t *output) {
  // Multiplication uses the distributive property:
  // (A_i + A_f) * (B_i + B_f) = (A_i*B_i) + (A_i*B_f) + (B_i*A_f) + (A_f*B_f)
  // We calculate each of the four partial products and sum them.

  uint64_t p1_int_int[CHUNK_SIZE] = {0};
  uint64_t p2_int_frac[CHUNK_SIZE];
  uint64_t p3_frac_int[CHUNK_SIZE];
  uint64_t p4_frac_frac[CHUNK_SIZE];

  const uint64_t int1 = value1[1];
  const uint64_t int2 = value2[1];
  const uint64_t *frac1 = value1 + 2;
  const uint64_t *frac2 = value2 + 2;

  // P1: Integer * Integer. Result is purely an integer part for this precision.
  p1_int_int[1] = (uint64_t)((unsigned i128)int1 * int2);

  // P2: Integer1 * Fractional2
  multiply_int_frac(p2_int_frac, int1, frac2);

  // P3: Fractional1 * Integer2
  multiply_int_frac(p3_frac_int, int2, frac1);

  // P4: Fractional1 * Fractional2
  multiply_frac_frac(p4_frac_frac, frac1, frac2);

  // Sum all partial products using raw addition.
  uint64_t temp_sum[CHUNK_SIZE];
  rawAdd(p1_int_int, p2_int_frac, temp_sum);
  rawAdd(temp_sum, p3_frac_int, temp_sum);
  rawAdd(temp_sum, p4_frac_frac, temp_sum);

  // Set the final sign. Positive if signs are the same, negative otherwise.
  temp_sum[0] = (value1[0] == value2[0]) ? POSITIVE : NEGATIVE;

  memcpy(output, temp_sum, CHUNK_SIZE * sizeof(uint64_t));
}

/**
 * @brief Squares a fixed-point number.
 * @param value Pointer to the operand.
 * @param output Pointer to store the result. Can be the same as the input.
 */
void square(const uint64_t *value, uint64_t *output) {
  // Squaring is a special case of multiplication:
  // (A_i + A_f)^2 = (A_i*A_i) + 2*(A_i*A_f) + (A_f*A_f)
  // This is faster than a general multiply as it computes (A_i*A_f) once.

  uint64_t p1_int_sq[CHUNK_SIZE] = {0};
  uint64_t p2_int_frac[CHUNK_SIZE];
  uint64_t p3_frac_sq[CHUNK_SIZE];

  const uint64_t integer_part = value[1];
  const uint64_t *frac_part = value + 2;

  // P1: Integer^2
  p1_int_sq[1] = (uint64_t)((unsigned i128)integer_part * integer_part);

  // P2: Integer * Fractional
  multiply_int_frac(p2_int_frac, integer_part, frac_part);

  // P3: Fractional^2
  multiply_frac_frac(p3_frac_sq, frac_part, frac_part);

  // Sum the parts: P1 + 2*P2 + P3
  uint64_t temp_sum[CHUNK_SIZE];
  rawAdd(p2_int_frac, p2_int_frac, temp_sum); // Calculate 2 * P2
  rawAdd(temp_sum, p1_int_sq, temp_sum);
  rawAdd(temp_sum, p3_frac_sq, temp_sum);

  // The result of a square is always positive.
  temp_sum[0] = POSITIVE;

  memcpy(output, temp_sum, CHUNK_SIZE * sizeof(uint64_t));
}
}