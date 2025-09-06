import { PostcodeEncoder } from "../PostcodeEncoder";
import { PostcodeClient } from "../PostcodeClient";
import { PostcodeRecord } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("PostcodeEncoder", () => {
  const testRecords: PostcodeRecord[] = [
    { postcode: "M1 1AA", lat: 53.4808, lon: -2.2426 },
    { postcode: "M1 1AB", lat: 53.4809, lon: -2.2427 },
    { postcode: "M1 1AC", lat: 53.481, lon: -2.2428 },
    { postcode: "SW1A 1AA", lat: 51.5014, lon: -0.1419 },
    { postcode: "SW1A 1AB", lat: 51.5015, lon: -0.142 },
    { postcode: "E1 6AN", lat: 51.52, lon: -0.0543 },
    { postcode: "W1A 0AX", lat: 51.5154, lon: -0.1553 },
  ];

  const testCsvPath = path.join(__dirname, "test-data.csv");

  beforeAll(() => {
    // Create test CSV file
    const csvContent = [
      "postcode,latitude,longitude",
      ...testRecords.map((r) => `${r.postcode},${r.lat},${r.lon}`),
    ].join("\n");
    fs.writeFileSync(testCsvPath, csvContent);
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testCsvPath)) {
      fs.unlinkSync(testCsvPath);
    }
  });

  describe("Constructor", () => {
    it("should create encoder with CSV path", () => {
      const encoder = new PostcodeEncoder(testCsvPath);
      expect(encoder).toBeInstanceOf(PostcodeEncoder);
    });

    it("should create encoder with empty path", () => {
      const encoder = new PostcodeEncoder("");
      expect(encoder).toBeInstanceOf(PostcodeEncoder);
    });
  });

  describe("Static Methods", () => {
    describe("createTestEncoder", () => {
      it("should create encoder with default test data", () => {
        const encoder = PostcodeEncoder.createTestEncoder();
        expect(encoder).toBeInstanceOf(PostcodeEncoder);

        const stats = encoder.getStats();
        expect(stats.totalOutwards).toBeGreaterThan(0);
        expect(stats.totalPostcodes).toBeGreaterThan(0);
      });

      it("should create encoder with custom test data", () => {
        const customRecords: PostcodeRecord[] = [
          { postcode: "B1 1AA", lat: 52.4862, lon: -1.8904 },
          { postcode: "B1 1AB", lat: 52.4863, lon: -1.8905 },
        ];

        const encoder = PostcodeEncoder.createTestEncoder(customRecords);
        const stats = encoder.getStats();
        expect(stats.totalPostcodes).toBe(2);
        expect(stats.totalOutwards).toBe(1);
      });
    });
  });

  describe("Encoding Methods", () => {
    describe("encodeFromRecords", () => {
      it("should encode records to buffer", () => {
        const encoder = new PostcodeEncoder("");
        const buffer = encoder.encodeFromRecords(testRecords);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);

        // Verify buffer starts with magic bytes
        expect(buffer.toString("ascii", 0, 4)).toBe("PCDB");
      });

      it("should handle empty records", () => {
        const encoder = new PostcodeEncoder("");
        const buffer = encoder.encodeFromRecords([]);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0); // Should still have header
      });

      it("should handle single record", () => {
        const encoder = new PostcodeEncoder("");
        const singleRecord = [testRecords[0]];
        const buffer = encoder.encodeFromRecords(singleRecord);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
      });

      it("should clear previous data when encoding new records", () => {
        const encoder = new PostcodeEncoder("");

        // First encoding
        const buffer1 = encoder.encodeFromRecords([testRecords[0]!]);
        const client1 = new PostcodeClient(buffer1);
        expect(client1.getStats().totalPostcodes).toBe(1);

        // Second encoding with different data
        const buffer2 = encoder.encodeFromRecords([
          testRecords[1]!,
          testRecords[2]!,
        ]);
        const client2 = new PostcodeClient(buffer2);
        expect(client2.getStats().totalPostcodes).toBe(2);
      });
    });

    describe("encode", () => {
      it("should encode from CSV file to buffer", () => {
        const encoder = new PostcodeEncoder(testCsvPath);
        const buffer = encoder.encode();

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
        expect(buffer.toString("ascii", 0, 4)).toBe("PCDB");
      });
    });

    describe("build", () => {
      const testOutputPath = path.join(__dirname, "test-output.pcod");

      afterEach(() => {
        // Clean up test output file
        if (fs.existsSync(testOutputPath)) {
          fs.unlinkSync(testOutputPath);
        }
      });

      it("should build and write to specified file", () => {
        const encoder = new PostcodeEncoder(testCsvPath);
        encoder.build(testOutputPath);

        expect(fs.existsSync(testOutputPath)).toBe(true);
        const fileBuffer = fs.readFileSync(testOutputPath);
        expect(fileBuffer.toString("ascii", 0, 4)).toBe("PCDB");
      });

      it("should build and write to default file path", () => {
        const encoder = new PostcodeEncoder(testCsvPath);
        const expectedPath = testCsvPath.replace(".csv", ".pcod");

        encoder.build();

        expect(fs.existsSync(expectedPath)).toBe(true);
        fs.unlinkSync(expectedPath); // Clean up
      });
    });
  });

  describe("Data Integrity", () => {
    it("should preserve coordinate accuracy", () => {
      const encoder = new PostcodeEncoder("");
      const buffer = encoder.encodeFromRecords(testRecords);
      const client = new PostcodeClient(buffer);

      testRecords.forEach((record) => {
        const result = client.lookup(record.postcode);
        expect(result).not.toBeNull();

        if (result) {
          // Allow for small rounding errors due to quantization (5 decimal places)
          const latDiff = Math.abs(result.lat - record.lat);
          const lonDiff = Math.abs(result.lon - record.lon);
          expect(latDiff).toBeLessThan(0.00001);
          expect(lonDiff).toBeLessThan(0.00001);
        }
      });
    });

    it("should handle postcodes with same outward but different sectors", () => {
      const sameOutwardRecords: PostcodeRecord[] = [
        { postcode: "M1 1AA", lat: 53.4808, lon: -2.2426 },
        { postcode: "M1 2AA", lat: 53.481, lon: -2.243 },
        { postcode: "M1 3AA", lat: 53.4812, lon: -2.2434 },
      ];

      const encoder = new PostcodeEncoder("");
      const buffer = encoder.encodeFromRecords(sameOutwardRecords);
      const client = new PostcodeClient(buffer);

      sameOutwardRecords.forEach((record) => {
        const result = client.lookup(record.postcode);
        expect(result).not.toBeNull();
        expect(result?.postcode).toBe(record.postcode);
      });
    });

    it("should handle postcodes with same sector but different units", () => {
      const sameSectorRecords: PostcodeRecord[] = [
        { postcode: "M1 1AA", lat: 53.4808, lon: -2.2426 },
        { postcode: "M1 1AB", lat: 53.4809, lon: -2.2427 },
        { postcode: "M1 1AC", lat: 53.481, lon: -2.2428 },
        { postcode: "M1 1AD", lat: 53.4811, lon: -2.2429 },
      ];

      const encoder = new PostcodeEncoder("");
      const buffer = encoder.encodeFromRecords(sameSectorRecords);
      const client = new PostcodeClient(buffer);

      sameSectorRecords.forEach((record) => {
        const result = client.lookup(record.postcode);
        expect(result).not.toBeNull();
        expect(result?.postcode).toBe(record.postcode);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle duplicate postcodes (keep first)", () => {
      const duplicateRecords: PostcodeRecord[] = [
        { postcode: "M1 1AA", lat: 53.4808, lon: -2.2426 },
        { postcode: "M1 1AA", lat: 53.4999, lon: -2.2999 }, // Different coordinates
        { postcode: "M1 1AB", lat: 53.4809, lon: -2.2427 },
      ];

      const encoder = new PostcodeEncoder("");
      const buffer = encoder.encodeFromRecords(duplicateRecords);
      const client = new PostcodeClient(buffer);

      const result = client.lookup("M1 1AA");
      expect(result).not.toBeNull();
      // Should have first occurrence coordinates
      expect(result?.lat).toBeCloseTo(53.4808, 5);
      expect(result?.lon).toBeCloseTo(-2.2426, 5);
    });

    it("should handle extreme coordinates", () => {
      const extremeRecords: PostcodeRecord[] = [
        { postcode: "EX1 1AA", lat: 90.0, lon: 180.0 }, // North pole, date line
        { postcode: "EX1 1AB", lat: -90.0, lon: -180.0 }, // South pole, date line
        { postcode: "EX1 1AC", lat: 0.0, lon: 0.0 }, // Equator, prime meridian
      ];

      const encoder = new PostcodeEncoder("");
      const buffer = encoder.encodeFromRecords(extremeRecords);
      const client = new PostcodeClient(buffer);

      extremeRecords.forEach((record) => {
        const result = client.lookup(record.postcode);
        expect(result).not.toBeNull();
        expect(result?.lat).toBeCloseTo(record.lat, 4);
        expect(result?.lon).toBeCloseTo(record.lon, 4);
      });
    });

    it("should handle invalid postcodes gracefully", () => {
      const invalidRecords: PostcodeRecord[] = [
        { postcode: "INVALID", lat: 53.4808, lon: -2.2426 },
        { postcode: "", lat: 53.4809, lon: -2.2427 },
        { postcode: "M1 1AA", lat: 53.481, lon: -2.2428 }, // Valid one
      ];

      const encoder = new PostcodeEncoder("");
      const buffer = encoder.encodeFromRecords(invalidRecords);
      const client = new PostcodeClient(buffer);

      // Should only contain the valid postcode
      expect(client.getStats().totalPostcodes).toBe(1);
      expect(client.lookup("M1 1AA")).not.toBeNull();
      expect(client.lookup("INVALID")).toBeNull();
    });
  });

  describe("Performance", () => {
    it("should encode small dataset quickly", () => {
      const encoder = new PostcodeEncoder("");

      const startTime = Date.now();
      const buffer = encoder.encodeFromRecords(testRecords);
      const endTime = Date.now();

      expect(buffer).toBeInstanceOf(Buffer);
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast for small dataset
    });

    it("should produce consistent buffer sizes for same data", () => {
      const encoder1 = new PostcodeEncoder("");
      const encoder2 = new PostcodeEncoder("");

      const buffer1 = encoder1.encodeFromRecords(testRecords);
      const buffer2 = encoder2.encodeFromRecords(testRecords);

      expect(buffer1.length).toBe(buffer2.length);
      expect(buffer1.equals(buffer2)).toBe(true);
    });
  });

  describe("Statistics", () => {
    it("should return correct stats after encoding", () => {
      const encoder = PostcodeEncoder.createTestEncoder(testRecords);
      const stats = encoder.getStats();

      expect(stats.totalPostcodes).toBe(testRecords.length);
      expect(stats.totalOutwards).toBeGreaterThan(0);
      expect(stats.totalOutwards).toBeLessThanOrEqual(testRecords.length);
    });

    it("should return zero stats for empty encoder", () => {
      const encoder = new PostcodeEncoder("");
      const stats = encoder.getStats();

      expect(stats.totalPostcodes).toBe(0);
      expect(stats.totalOutwards).toBe(0);
    });
  });
});
