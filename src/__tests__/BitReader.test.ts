import { BitReader } from "../BitReader";
import { BitWriter } from "../BitWriter";

describe("BitReader", () => {
  describe("Constructor", () => {
    it("should create BitReader with buffer", () => {
      const buffer = Buffer.from([0xff, 0x00, 0xaa]);
      const reader = new BitReader(buffer);
      expect(reader).toBeInstanceOf(BitReader);
      expect(reader.getBitOffset()).toBe(0);
    });

    it("should create BitReader with buffer and offset", () => {
      const buffer = Buffer.from([0xff, 0x00, 0xaa]);
      const reader = new BitReader(buffer, 8);
      expect(reader.getBitOffset()).toBe(8);
    });
  });

  describe("Basic Bit Reading", () => {
    it("should read single bits correctly", () => {
      // 0xFF = 11111111
      const buffer = Buffer.from([0xff]);
      const reader = new BitReader(buffer);

      for (let i = 0; i < 8; i++) {
        expect(reader.readBit()).toBe(1);
      }
    });

    it("should read zero bits correctly", () => {
      // 0x00 = 00000000
      const buffer = Buffer.from([0x00]);
      const reader = new BitReader(buffer);

      for (let i = 0; i < 8; i++) {
        expect(reader.readBit()).toBe(0);
      }
    });

    it("should read alternating bits correctly", () => {
      // 0xAA = 10101010 (MSB first), but we read LSB first: 01010101
      const buffer = Buffer.from([0xaa]);
      const reader = new BitReader(buffer);

      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
    });
  });

  describe("Multi-bit Reading", () => {
    it("should read multiple bits correctly", () => {
      // 0xFF = 11111111
      const buffer = Buffer.from([0xff]);
      const reader = new BitReader(buffer);

      expect(reader.readBits(4)).toBe(0x0f); // 1111
      expect(reader.readBits(4)).toBe(0x0f); // 1111
    });

    it("should read bits across byte boundaries", () => {
      // 0xFF, 0x00 = 11111111 00000000 (LSB-first reading)
      const buffer = Buffer.from([0xff, 0x00]);
      const reader = new BitReader(buffer);

      expect(reader.readBits(4)).toBe(0x0f); // 1111
      expect(reader.readBits(8)).toBe(0x0f); // 11110000 -> 00001111 (LSB first)
      expect(reader.readBits(4)).toBe(0x00); // 0000
    });

    it("should handle zero bit reads", () => {
      const buffer = Buffer.from([0xff]);
      const reader = new BitReader(buffer);

      expect(reader.readBits(0)).toBe(0);
      expect(reader.getBitOffset()).toBe(0);
    });

    it("should read maximum 32 bits", () => {
      const buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]);
      const reader = new BitReader(buffer);

      const result = reader.readBits(32);
      expect(result >>> 0).toBe(0xffffffff); // Use unsigned right shift to handle sign
    });
  });

  describe("Error Handling", () => {
    it("should throw error for invalid bit count", () => {
      const buffer = Buffer.from([0xff]);
      const reader = new BitReader(buffer);

      expect(() => reader.readBits(-1)).toThrow();
      expect(() => reader.readBits(33)).toThrow();
    });

    it("should throw error when reading beyond buffer", () => {
      const buffer = Buffer.from([0xff]);
      const reader = new BitReader(buffer);

      reader.readBits(8); // Read all bits
      expect(() => reader.readBits(1)).toThrow();
    });
  });

  describe("Bit Offset Management", () => {
    it("should track bit offset correctly", () => {
      const buffer = Buffer.from([0xff, 0x00]);
      const reader = new BitReader(buffer);

      expect(reader.getBitOffset()).toBe(0);
      reader.readBits(3);
      expect(reader.getBitOffset()).toBe(3);
      reader.readBits(5);
      expect(reader.getBitOffset()).toBe(8);
      reader.readBits(8);
      expect(reader.getBitOffset()).toBe(16);
    });

    it("should set bit offset correctly", () => {
      const buffer = Buffer.from([0xff, 0x00, 0xaa]);
      const reader = new BitReader(buffer);

      reader.setBitOffset(8);
      expect(reader.getBitOffset()).toBe(8);
      expect(reader.readBits(8)).toBe(0x00);
    });

    it("should skip bits correctly", () => {
      const buffer = Buffer.from([0xff, 0x00, 0xaa]);
      const reader = new BitReader(buffer);

      reader.skipBits(8);
      expect(reader.getBitOffset()).toBe(8);
      expect(reader.readBits(8)).toBe(0x00);
    });

    it("should align to byte boundary", () => {
      const buffer = Buffer.from([0xff, 0x00, 0xaa]);
      const reader = new BitReader(buffer);

      reader.readBits(3); // Offset = 3
      reader.alignToByte(); // Should move to offset 8
      expect(reader.getBitOffset()).toBe(8);
      expect(reader.readBits(8)).toBe(0x00);
    });

    it("should not change offset when already aligned", () => {
      const buffer = Buffer.from([0xff, 0x00, 0xaa]);
      const reader = new BitReader(buffer);

      reader.readBits(8); // Offset = 8 (aligned)
      reader.alignToByte();
      expect(reader.getBitOffset()).toBe(8);
    });
  });

  describe("Integration with BitWriter", () => {
    it("should read what BitWriter writes", () => {
      const writer = new BitWriter();

      // Write test data
      writer.writeBits(0x0f, 4); // 1111
      writer.writeBits(0x00, 4); // 0000
      writer.writeBits(0xaa, 8); // 10101010
      writer.writeBits(0x05, 3); // 101

      const buffer = writer.getBuffer();
      const reader = new BitReader(buffer);

      // Read back the same data
      expect(reader.readBits(4)).toBe(0x0f);
      expect(reader.readBits(4)).toBe(0x00);
      expect(reader.readBits(8)).toBe(0xaa);
      expect(reader.readBits(3)).toBe(0x05);
    });

    it("should handle complex bit patterns", () => {
      const writer = new BitWriter();
      const testValues = [
        { value: 0x1f, bits: 5 },
        { value: 0x3ff, bits: 10 },
        { value: 0x7, bits: 3 },
        { value: 0xffff, bits: 16 },
        { value: 0x1, bits: 1 },
        { value: 0x0, bits: 7 },
      ];

      // Write test values
      testValues.forEach(({ value, bits }) => {
        writer.writeBits(value, bits);
      });

      const buffer = writer.getBuffer();
      const reader = new BitReader(buffer);

      // Read back and verify
      testValues.forEach(({ value, bits }) => {
        expect(reader.readBits(bits)).toBe(value);
      });
    });

    it("should handle large values correctly", () => {
      const writer = new BitWriter();
      const largeValue = 0x12345678;

      writer.writeBits(largeValue, 32);

      const buffer = writer.getBuffer();
      const reader = new BitReader(buffer);

      expect(reader.readBits(32)).toBe(largeValue);
    });

    it("should maintain bit order consistency", () => {
      const writer = new BitWriter();

      // Write individual bits
      for (let i = 0; i < 8; i++) {
        writer.writeBits(i % 2, 1);
      }

      const buffer = writer.getBuffer();
      const reader = new BitReader(buffer);

      // Read back individual bits
      for (let i = 0; i < 8; i++) {
        expect(reader.readBit()).toBe(i % 2);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty buffer", () => {
      const buffer = Buffer.alloc(0);
      const reader = new BitReader(buffer);

      expect(() => reader.readBit()).toThrow();
    });

    it("should handle single byte buffer", () => {
      const buffer = Buffer.from([0x5a]); // 01011010
      const reader = new BitReader(buffer);

      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(0);
      expect(reader.readBit()).toBe(1);
      expect(reader.readBit()).toBe(0);
    });

    it("should handle reading exactly buffer size in bits", () => {
      const buffer = Buffer.from([0xff, 0x00]);
      const reader = new BitReader(buffer);

      const result = reader.readBits(16);
      expect(result).toBe(0x00ff); // LSB-first: 0xFF, 0x00 -> 0x00FF
      expect(reader.getBitOffset()).toBe(16);
    });
  });
});
