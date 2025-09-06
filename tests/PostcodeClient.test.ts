import { PostcodeEncoder } from "../extract_ons_postcodes.ts/PostcodeEncoder";
import { PostcodeClient } from "../extract_ons_postcodes.ts/PostcodeClient";
import { PostcodeRecord } from "../extract_ons_postcodes.ts/types";

describe("PostcodeClient", () => {
  let testBuffer: Buffer;
  let client: PostcodeClient;

  const testRecords: PostcodeRecord[] = [
    { postcode: "M1 1AA", lat: 53.4808, lon: -2.2426 },
    { postcode: "M1 1AB", lat: 53.4809, lon: -2.2427 },
    { postcode: "M1 2AA", lat: 53.481, lon: -2.243 },
    { postcode: "SW1A 1AA", lat: 51.5014, lon: -0.1419 },
    { postcode: "SW1A 1AB", lat: 51.5015, lon: -0.142 },
  ];

  beforeAll(() => {
    const encoder = new PostcodeEncoder("");
    testBuffer = encoder.encodeFromRecords(testRecords);
    client = new PostcodeClient(testBuffer);
  });

  describe("Constructor", () => {
    it("should create client with valid buffer", () => {
      expect(client).toBeInstanceOf(PostcodeClient);
    });

    it("should throw error for invalid buffer", () => {
      const invalidBuffer = Buffer.from("invalid data");
      expect(() => new PostcodeClient(invalidBuffer)).toThrow();
    });

    it("should throw error for empty buffer", () => {
      const emptyBuffer = Buffer.alloc(0);
      expect(() => new PostcodeClient(emptyBuffer)).toThrow();
    });

    it("should throw error for buffer with wrong magic", () => {
      const wrongMagicBuffer = Buffer.alloc(32);
      wrongMagicBuffer.write("XXXX", 0, 4, "ascii"); // Wrong magic
      expect(() => new PostcodeClient(wrongMagicBuffer)).toThrow();
    });
  });

  describe("Lookup Operations", () => {
    describe("lookup", () => {
      it("should find existing postcodes", () => {
        testRecords.forEach((record) => {
          const result = client.lookup(record.postcode);
          expect(result).not.toBeNull();
          expect(result?.postcode).toBe(record.postcode);
          expect(result?.lat).toBeCloseTo(record.lat, 4);
          expect(result?.lon).toBeCloseTo(record.lon, 4);
        });
      });

      it("should return null for non-existent postcodes", () => {
        const nonExistent = [
          "XX1 1XX",
          "M1 9ZZ",
          "INVALID",
          "",
          "M1 1",
          "M1 1AAA",
        ];

        nonExistent.forEach((postcode) => {
          const result = client.lookup(postcode);
          expect(result).toBeNull();
        });
      });

      it("should handle case insensitive lookups", () => {
        const result1 = client.lookup("m1 1aa");
        const result2 = client.lookup("M1 1AA");
        const result3 = client.lookup("M1 1aa");

        expect(result1).not.toBeNull();
        expect(result2).not.toBeNull();
        expect(result3).not.toBeNull();

        if (result1 && result2 && result3) {
          expect(result1.lat).toBe(result2.lat);
          expect(result1.lon).toBe(result2.lon);
          expect(result2.lat).toBe(result3.lat);
          expect(result2.lon).toBe(result3.lon);
        }
      });

      it("should handle postcodes with extra spaces", () => {
        const variations = ["M1  1AA", " M1 1AA ", "M1   1AA", "M11AA"];

        variations.forEach((variation) => {
          const result = client.lookup(variation);
          expect(result).not.toBeNull();
          expect(result?.lat).toBeCloseTo(53.4808, 4);
        });
      });
    });

    describe("isValidPostcode", () => {
      it("should return true for valid postcodes", () => {
        testRecords.forEach((record) => {
          expect(client.isValidPostcode(record.postcode)).toBe(true);
        });
      });

      it("should return false for invalid postcodes", () => {
        const invalid = ["XX1 1XX", "INVALID", "", "M1 9ZZ"];
        invalid.forEach((postcode) => {
          expect(client.isValidPostcode(postcode)).toBe(false);
        });
      });
    });
  });

  describe("Enumeration Operations", () => {
    describe("getOutwardList", () => {
      it("should return sorted list of outwards", () => {
        const outwards = client.getOutwardList();
        expect(outwards).toContain("M1");
        expect(outwards).toContain("SW1A");

        // Should be sorted
        const sorted = [...outwards].sort();
        expect(outwards).toEqual(sorted);
      });

      it("should return unique outwards", () => {
        const outwards = client.getOutwardList();
        const unique = [...new Set(outwards)];
        expect(outwards.length).toBe(unique.length);
      });
    });

    describe("findNearbyOutwards", () => {
      it("should find outwards with matching prefix", () => {
        const m1Results = client.findNearbyOutwards("M1");
        expect(m1Results).toContain("M1");

        const swResults = client.findNearbyOutwards("SW");
        expect(swResults).toContain("SW1A");
      });

      it("should return empty array for non-matching prefix", () => {
        const results = client.findNearbyOutwards("ZZ");
        expect(results).toEqual([]);
      });

      it("should handle case insensitive search", () => {
        const results1 = client.findNearbyOutwards("m1");
        const results2 = client.findNearbyOutwards("M1");
        expect(results1).toEqual(results2);
      });
    });

    describe("enumerateOutward", () => {
      it("should return all postcodes for an outward", () => {
        const m1Postcodes = client.enumerateOutward("M1");
        expect(m1Postcodes.length).toBe(3); // M1 1AA, M1 1AB, M1 2AA

        const postcodes = m1Postcodes.map((p) => p.postcode);
        expect(postcodes).toContain("M1 1AA");
        expect(postcodes).toContain("M1 1AB");
        expect(postcodes).toContain("M1 2AA");
      });

      it("should return empty array for non-existent outward", () => {
        const results = client.enumerateOutward("XX1");
        expect(results).toEqual([]);
      });

      it("should return postcodes with correct coordinates", () => {
        const m1Postcodes = client.enumerateOutward("M1");
        m1Postcodes.forEach((result) => {
          const original = testRecords.find(
            (r) => r.postcode === result.postcode
          );
          expect(original).toBeDefined();
          if (original) {
            expect(result.lat).toBeCloseTo(original.lat, 4);
            expect(result.lon).toBeCloseTo(original.lon, 4);
          }
        });
      });
    });
  });

  describe("Statistics", () => {
    describe("getStats", () => {
      it("should return correct statistics", () => {
        const stats = client.getStats();
        expect(stats.totalPostcodes).toBe(testRecords.length);
        expect(stats.totalOutwards).toBe(2); // M1 and SW1A
        expect(stats.fileSize).toBe(testBuffer.length);
        expect(stats.quantizationStep).toBe(0.00001);
      });
    });
  });

  describe("Performance", () => {
    it("should perform lookups quickly", () => {
      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        client.lookup("M1 1AA");
      }

      const endTime = Date.now();
      const timePerLookup = (endTime - startTime) / iterations;

      // Should be very fast (less than 1ms per lookup)
      expect(timePerLookup).toBeLessThan(1);
    });

    it("should handle rapid successive lookups", () => {
      const postcodes = testRecords.map((r) => r.postcode);

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        postcodes.forEach((postcode) => {
          const result = client.lookup(postcode);
          expect(result).not.toBeNull();
        });
      }
      const endTime = Date.now();

      // Should complete 500 lookups (100 * 5 postcodes) quickly
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe("Memory Usage", () => {
    it("should not leak memory on repeated operations", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 100; i++) {
        client.lookup("M1 1AA");
        client.getOutwardList();
        client.enumerateOutward("M1");
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 10MB in test environment)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });
  });
});
