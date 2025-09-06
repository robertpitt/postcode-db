/**
 * Varint (unsigned LEB128) utilities for encoding/decoding unit lists
 * As specified in v3 format section 4
 */
export class VarintUtils {
  /**
   * Encode an unsigned integer as varint (LEB128)
   * @param value The value to encode (must be >= 0)
   * @returns Buffer containing the encoded varint
   */
  static encode(value: number): Buffer {
    if (value < 0) {
      throw new Error("Varint encoding requires non-negative values");
    }

    const bytes: number[] = [];

    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(value & 0x7f);

    return Buffer.from(bytes);
  }

  /**
   * Decode a varint from a buffer at the given offset
   * @param buffer The buffer to read from
   * @param offset The offset to start reading
   * @returns Object with decoded value and bytes consumed
   */
  static decode(
    buffer: Buffer,
    offset: number
  ): { value: number; bytesRead: number } {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;

    while (offset + bytesRead < buffer.length) {
      const byte = buffer[offset + bytesRead];
      if (byte === undefined) {
        throw new Error("Unexpected end of buffer");
      }
      bytesRead++;

      value |= (byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        return { value, bytesRead };
      }

      shift += 7;
      if (shift >= 32) {
        throw new Error("Varint too long");
      }
    }

    throw new Error("Incomplete varint");
  }

  /**
   * Calculate the byte length of a varint-encoded value
   * @param value The value to measure
   * @returns Number of bytes required
   */
  static getByteLength(value: number): number {
    if (value < 0) {
      throw new Error("Varint encoding requires non-negative values");
    }

    if (value === 0) return 1;

    return 1 + Math.floor(Math.log2(value) / 7);
  }

  /**
   * Encode a sequence of values with delta compression
   * First value is absolute, subsequent values are deltas
   * @param values Array of sorted values
   * @returns Buffer containing the encoded sequence
   */
  static encodeDeltaSequence(values: number[]): Buffer {
    if (values.length === 0) {
      return Buffer.alloc(0);
    }

    const buffers: Buffer[] = [];

    // First value is absolute
    const firstValue = values[0];
    if (firstValue === undefined) {
      throw new Error("Empty values array");
    }
    buffers.push(this.encode(firstValue));

    // Subsequent values are deltas
    for (let i = 1; i < values.length; i++) {
      const currentValue = values[i];
      const prevValue = values[i - 1];
      if (currentValue === undefined || prevValue === undefined) {
        throw new Error("Missing values in sequence");
      }
      const delta = currentValue - prevValue;
      if (delta < 0) {
        throw new Error("Delta sequence requires sorted values");
      }
      buffers.push(this.encode(delta));
    }

    return Buffer.concat(buffers);
  }

  /**
   * Decode a delta-compressed sequence
   * @param buffer The buffer to read from
   * @param offset The offset to start reading
   * @param count Number of values to decode
   * @returns Object with decoded values and bytes consumed
   */
  static decodeDeltaSequence(
    buffer: Buffer,
    offset: number,
    count: number
  ): { values: number[]; bytesRead: number } {
    const values: number[] = [];
    let currentOffset = offset;
    let totalBytesRead = 0;

    for (let i = 0; i < count; i++) {
      const { value, bytesRead } = this.decode(buffer, currentOffset);

      if (i === 0) {
        // First value is absolute
        values.push(value);
      } else {
        // Subsequent values are deltas
        const prevValue = values[i - 1];
        if (prevValue === undefined) {
          throw new Error("Missing previous value in delta sequence");
        }
        values.push(prevValue + value);
      }

      currentOffset += bytesRead;
      totalBytesRead += bytesRead;
    }

    return { values, bytesRead: totalBytesRead };
  }
}
