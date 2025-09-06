/**
 * BitWriter - Utility for writing bits to a buffer with LSB-first bit packing
 * Used for encoding coordinate deltas in the v3 format
 */
export class BitWriter {
  private buffer: number[] = [];
  private currentByte = 0;
  private bitPosition = 0; // 0-7, position within current byte

  /**
   * Write bits to the stream (LSB-first within the stream)
   * @param value The value to write
   * @param bitCount Number of bits to write (1-32)
   */
  writeBits(value: number, bitCount: number): void {
    if (bitCount < 0 || bitCount > 32) {
      throw new Error(`Invalid bit count: ${bitCount}`);
    }

    // Handle 0-bit case (no bits to write)
    if (bitCount === 0) {
      return;
    }

    let remainingBits = bitCount;
    let remainingValue = value;

    while (remainingBits > 0) {
      const bitsToWrite = Math.min(remainingBits, 8 - this.bitPosition);
      const mask = (1 << bitsToWrite) - 1;
      const bitsValue = remainingValue & mask;

      this.currentByte |= bitsValue << this.bitPosition;
      this.bitPosition += bitsToWrite;

      if (this.bitPosition >= 8) {
        this.buffer.push(this.currentByte);
        this.currentByte = 0;
        this.bitPosition = 0;
      }

      remainingValue >>= bitsToWrite;
      remainingBits -= bitsToWrite;
    }
  }

  /**
   * Pad to the next byte boundary with zero bits
   */
  padToByte(): void {
    if (this.bitPosition > 0) {
      this.buffer.push(this.currentByte);
      this.currentByte = 0;
      this.bitPosition = 0;
    }
  }

  /**
   * Get the current bit offset (total bits written)
   */
  getBitOffset(): number {
    return this.buffer.length * 8 + this.bitPosition;
  }

  /**
   * Get the final buffer (automatically pads to byte boundary)
   */
  getBuffer(): Buffer {
    this.padToByte();
    return Buffer.from(this.buffer);
  }

  /**
   * Reset the writer for reuse
   */
  reset(): void {
    this.buffer = [];
    this.currentByte = 0;
    this.bitPosition = 0;
  }
}
