/**
 * BitReader - Reads bits from a buffer at arbitrary bit positions
 */
export class BitReader {
  private buffer: Buffer;
  private bitOffset: number;

  constructor(buffer: Buffer, bitOffset: number = 0) {
    this.buffer = buffer;
    this.bitOffset = bitOffset;
  }

  /**
   * Read a specified number of bits as an unsigned integer
   * Uses LSB-first bit order to match BitWriter
   */
  readBits(numBits: number): number {
    if (numBits < 0 || numBits > 32) {
      throw new Error("Can only read 0-32 bits at a time");
    }

    // Handle the case where 0 bits are requested
    if (numBits === 0) {
      return 0;
    }

    let result = 0;
    let bitsRead = 0;

    while (bitsRead < numBits) {
      const byteIndex = Math.floor(this.bitOffset / 8);
      const bitIndex = this.bitOffset % 8;

      if (byteIndex >= this.buffer.length) {
        throw new Error("Attempted to read beyond buffer");
      }

      const byte = this.buffer[byteIndex];
      if (byte === undefined) {
        throw new Error("Attempted to read beyond buffer");
      }

      const bitsInThisByte = Math.min(8 - bitIndex, numBits - bitsRead);

      // Extract bits from this byte (LSB-first order)
      const mask = (1 << bitsInThisByte) - 1;
      const bits = (byte >> bitIndex) & mask;

      result |= bits << bitsRead;
      bitsRead += bitsInThisByte;
      this.bitOffset += bitsInThisByte;
    }

    return result;
  }

  /**
   * Read a single bit
   */
  readBit(): number {
    return this.readBits(1);
  }

  /**
   * Get current bit position
   */
  getBitOffset(): number {
    return this.bitOffset;
  }

  /**
   * Set bit position
   */
  setBitOffset(offset: number): void {
    this.bitOffset = offset;
  }

  /**
   * Skip bits
   */
  skipBits(numBits: number): void {
    this.bitOffset += numBits;
  }

  /**
   * Align to next byte boundary
   */
  alignToByte(): void {
    const remainder = this.bitOffset % 8;
    if (remainder !== 0) {
      this.bitOffset += 8 - remainder;
    }
  }
}
