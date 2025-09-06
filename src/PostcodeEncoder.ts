import * as fs from "fs";
import * as path from "path";
import {
  PostcodeRecord,
  OutwardData,
  SectorData,
  UnitData,
  V3Header,
  OutwardIndexEntry,
  SectorEntry,
} from "./types";
import { PostcodeNormalizer } from "./PostcodeNormalizer";
import { BitWriter } from "./BitWriter";
import { VarintUtils } from "./VarintUtils";

/**
 * PostcodeEncoder - Converts CSV postcode data to v3 binary format
 * Implements the complete v3 specification from the design document
 */
export class PostcodeEncoder {
  private csvFilePath: string;
  private outwardData: Map<string, OutwardData> = new Map();
  private globalLatOffset = 0;
  private globalLonOffset = 0;

  constructor(csvFilePath: string) {
    this.csvFilePath = csvFilePath;
  }

  /**
   * Main build method - implements the complete encoding process and writes to file
   */
  build(outputPath?: string): void {
    // Determine output path
    if (!outputPath) {
      const csvDir = path.dirname(this.csvFilePath);
      const csvName = path.basename(this.csvFilePath, ".csv");
      outputPath = path.join(csvDir, `${csvName}.pcod`);
    }

    try {
      const buffer = this.encode();
      fs.writeFileSync(outputPath, buffer);
    } catch (error) {
      console.error("Error during encoding:", error);
      throw error;
    }
  }

  /**
   * Encode to in-memory buffer - useful for testing and in-memory operations
   */
  encode(): Buffer {
    try {
      // Step 1: Read and process CSV data
      const records = this.readCsvFile();
      this.processRecords(records);

      // Step 2: Calculate global offsets
      this.calculateGlobalOffsets();

      // Step 3: Process sectors and calculate metadata
      this.processSectors();

      // Step 4: Generate binary buffer
      return this.generateBinaryBuffer();
    } catch (error) {
      console.error("Error during encoding:", error);
      throw error;
    }
  }

  /**
   * Encode from provided records (useful for testing with custom data)
   */
  encodeFromRecords(records: PostcodeRecord[]): Buffer {
    try {
      // Clear any existing data
      this.outwardData.clear();
      this.globalLatOffset = 0;
      this.globalLonOffset = 0;

      // Process the provided records
      this.processRecords(records);

      // Calculate global offsets
      this.calculateGlobalOffsets();

      // Process sectors and calculate metadata
      this.processSectors();

      // Generate binary buffer
      return this.generateBinaryBuffer();
    } catch (error) {
      console.error("Error during encoding:", error);
      throw error;
    }
  }

  /**
   * Read and parse CSV file
   */
  private readCsvFile(): PostcodeRecord[] {
    const content = fs.readFileSync(this.csvFilePath, "utf-8");
    const lines = content.trim().split("\n");
    const records: PostcodeRecord[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue; // Ignore empty lines

      const parts = this.parseCsvLine(line);
      if (parts.length < 3) continue;

      const postcode = parts[0]?.replace(/"/g, "").trim() || "";
      const latStr = parts[1];
      const lonStr = parts[2];
      if (!latStr || !lonStr) continue;

      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);

      // Skip rows where parsing fails
      if (!postcode || isNaN(lat) || isNaN(lon)) continue;

      records.push({ postcode, lat, lon });
    }

    return records;
  }

  /**
   * Parse CSV line handling quoted fields
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  /**
   * Process records and group by outward/sector/unit
   */
  private processRecords(records: PostcodeRecord[]): void {
    let validRecords = 0;
    let invalidRecords = 0;

    for (const record of records) {
      const parsed = PostcodeNormalizer.parsePostcode(record.postcode);
      if (!parsed) {
        invalidRecords++;
        continue;
      }

      validRecords++;

      // Scale coordinates to integers (5 decimal places)
      const latInt = Math.round(record.lat * 100000);
      const lonInt = Math.round(record.lon * 100000);

      // Get or create outward data
      let outwardData = this.outwardData.get(parsed.outward);
      if (!outwardData) {
        outwardData = {
          outward: parsed.outward,
          sectors: new Map(),
        };
        this.outwardData.set(parsed.outward, outwardData);
      }

      // Get or create sector data
      let sectorData = outwardData.sectors.get(parsed.sector);
      if (!sectorData) {
        sectorData = {
          sectorNumber: parsed.sector,
          units: [],
          latMin: latInt,
          lonMin: lonInt,
          latMax: latInt,
          lonMax: lonInt,
        };
        outwardData.sectors.set(parsed.sector, sectorData);
      }

      // Check for duplicate units (keep first occurrence)
      const existingUnit = sectorData.units.find(
        (u) => u.unitIndex === parsed.unitIndex
      );
      if (existingUnit) {
        continue; // Skip duplicate
      }

      // Add unit data
      sectorData.units.push({
        unitIndex: parsed.unitIndex,
        latInt,
        lonInt,
      });

      // Update sector bounds
      sectorData.latMin = Math.min(sectorData.latMin, latInt);
      sectorData.latMax = Math.max(sectorData.latMax, latInt);
      sectorData.lonMin = Math.min(sectorData.lonMin, lonInt);
      sectorData.lonMax = Math.max(sectorData.lonMax, lonInt);
    }
  }

  /**
   * Calculate global coordinate offsets
   */
  private calculateGlobalOffsets(): void {
    let minLat = Infinity;
    let minLon = Infinity;

    for (const outwardData of this.outwardData.values()) {
      for (const sectorData of outwardData.sectors.values()) {
        for (const unit of sectorData.units) {
          minLat = Math.min(minLat, unit.latInt);
          minLon = Math.min(minLon, unit.lonInt);
        }
      }
    }

    // Handle empty data case
    if (minLat === Infinity || minLon === Infinity) {
      this.globalLatOffset = 0;
      this.globalLonOffset = 0;
    } else {
      this.globalLatOffset = minLat;
      this.globalLonOffset = minLon;
    }
  }

  /**
   * Process sectors and sort units
   */
  private processSectors(): void {
    for (const outwardData of this.outwardData.values()) {
      for (const sectorData of outwardData.sectors.values()) {
        // Sort units by unit index (ascending)
        sectorData.units.sort((a, b) => a.unitIndex - b.unitIndex);
      }
    }
  }

  /**
   * Calculate minimal bit width for a value
   */
  private calculateBitWidth(maxValue: number): number {
    if (maxValue === 0) return 0;
    return Math.ceil(Math.log2(maxValue + 1));
  }

  /**
   * Choose representation mode (bitmap vs list) for a sector
   */
  private chooseSectorMode(sectorData: SectorData): {
    useList: boolean;
    listByteSize?: number;
  } {
    const unitCount = sectorData.units.length;

    if (unitCount === 0) {
      return { useList: false };
    }

    // Calculate list size with delta compression
    const indices = sectorData.units.map((u) => u.unitIndex);
    const firstIndex = indices[0];
    if (firstIndex === undefined) {
      return { useList: false };
    }

    let listByteSize = VarintUtils.getByteLength(firstIndex); // First absolute

    for (let i = 1; i < indices.length; i++) {
      const currentIndex = indices[i];
      const prevIndex = indices[i - 1];
      if (currentIndex === undefined || prevIndex === undefined) {
        continue;
      }
      const delta = currentIndex - prevIndex;
      listByteSize += VarintUtils.getByteLength(delta);
    }

    // Choose list if smaller than bitmap (85 bytes)
    return { useList: listByteSize < 85, listByteSize };
  }

  /**
   * Generate the complete binary buffer
   */
  private generateBinaryBuffer(): Buffer {
    // Sort outward codes lexicographically
    const sortedOutwards = Array.from(this.outwardData.keys()).sort();

    // Calculate total unit count
    let totalUnitCount = 0;
    for (const outwardKey of sortedOutwards) {
      const outwardData = this.outwardData.get(outwardKey);
      if (!outwardData) continue;

      for (const sectorData of outwardData.sectors.values()) {
        totalUnitCount += sectorData.units.length;
      }
    }

    // Prepare file structure
    const header: V3Header = {
      magic: "PCDB",
      version: 3,
      flags: 0,
      outwardCount: sortedOutwards.length,
      totalUnitCount,
      latOffset: this.globalLatOffset,
      lonOffset: this.globalLonOffset,
    };

    // Calculate offsets and build outward index
    let currentOffset = 32 + sortedOutwards.length * 9; // Header + outward index
    const outwardIndex: OutwardIndexEntry[] = [];

    for (const outwardKey of sortedOutwards) {
      const outwardData = this.outwardData.get(outwardKey);
      if (!outwardData) continue;

      const sectorCount = outwardData.sectors.size;

      outwardIndex.push({
        outwardCode: outwardKey.padEnd(4, "\0").slice(0, 4),
        sectorCount,
        sectorIndexOffset: currentOffset,
      });

      // Calculate block size
      const sectorTableSize = sectorCount * 14;
      let unitDataSize = 0;

      // Calculate unit data sizes for all sectors in this outward
      for (const sectorData of outwardData.sectors.values()) {
        const { useList, listByteSize } = this.chooseSectorMode(sectorData);

        // Calculate coordinate deltas and bit widths
        const latDeltas = sectorData.units.map(
          (u) => u.latInt - sectorData.latMin
        );
        const lonDeltas = sectorData.units.map(
          (u) => u.lonInt - sectorData.lonMin
        );
        const maxLatDelta =
          latDeltas.length > 0 ? Math.max(0, ...latDeltas) : 0;
        const maxLonDelta =
          lonDeltas.length > 0 ? Math.max(0, ...lonDeltas) : 0;
        const bitsLat = this.calculateBitWidth(maxLatDelta);
        const bitsLon = this.calculateBitWidth(maxLonDelta);

        // Unit representation size
        const representationSize = useList ? listByteSize || 0 : 85;

        // Coordinate stream size
        const coordinateBits = sectorData.units.length * (bitsLat + bitsLon);
        const coordinateBytes = Math.ceil(coordinateBits / 8);

        unitDataSize += representationSize + coordinateBytes;
      }

      currentOffset += sectorTableSize + unitDataSize;
    }

    // Build the buffer
    const buffers: Buffer[] = [];

    // Write header
    buffers.push(this.writeHeader(header));

    // Write outward index
    for (const entry of outwardIndex) {
      buffers.push(this.writeOutwardIndexEntry(entry));
    }

    // Write outward blocks
    for (const outwardKey of sortedOutwards) {
      const outwardData = this.outwardData.get(outwardKey);
      if (!outwardData) continue;

      buffers.push(this.writeOutwardBlock(outwardData));
    }

    // Combine and return
    return Buffer.concat(buffers);
  }

  /**
   * Write v3 header (32 bytes)
   */
  private writeHeader(header: V3Header): Buffer {
    const buffer = Buffer.alloc(32);
    let offset = 0;

    // Magic "PCDB" (4 bytes)
    buffer.write(header.magic, offset, 4, "ascii");
    offset += 4;

    // Version (1 byte)
    buffer.writeUInt8(header.version, offset);
    offset += 1;

    // Flags (1 byte)
    buffer.writeUInt8(header.flags, offset);
    offset += 1;

    // Outward count (2 bytes, u16)
    buffer.writeUInt16LE(header.outwardCount, offset);
    offset += 2;

    // Total unit count (4 bytes, u32)
    buffer.writeUInt32LE(header.totalUnitCount, offset);
    offset += 4;

    // Lat offset (4 bytes, i32)
    buffer.writeInt32LE(header.latOffset, offset);
    offset += 4;

    // Lon offset (4 bytes, i32)
    buffer.writeInt32LE(header.lonOffset, offset);
    offset += 4;

    // Reserved/padding (12 bytes) - already zeroed by Buffer.alloc

    return buffer;
  }

  /**
   * Write outward index entry (9 bytes)
   */
  private writeOutwardIndexEntry(entry: OutwardIndexEntry): Buffer {
    const buffer = Buffer.alloc(9);
    let offset = 0;

    // Outward code (4 bytes, padded with nulls)
    buffer.write(entry.outwardCode, offset, 4, "ascii");
    offset += 4;

    // Sector count (1 byte)
    buffer.writeUInt8(entry.sectorCount, offset);
    offset += 1;

    // Sector index offset (4 bytes, u32)
    buffer.writeUInt32LE(entry.sectorIndexOffset, offset);

    return buffer;
  }

  /**
   * Write complete outward block (sector table + unit data)
   */
  private writeOutwardBlock(outwardData: OutwardData): Buffer {
    const buffers: Buffer[] = [];

    // Sort sectors by number (0-9)
    const sortedSectors = Array.from(outwardData.sectors.values()).sort(
      (a, b) => a.sectorNumber - b.sectorNumber
    );

    // Calculate relative offsets for unit data
    const sectorTableSize = sortedSectors.length * 14;
    let currentRelativeOffset = sectorTableSize;

    const sectorEntries: SectorEntry[] = [];
    const unitDataBuffers: Buffer[] = [];

    // Process each sector
    for (const sectorData of sortedSectors) {
      const { useList, listByteSize } = this.chooseSectorMode(sectorData);

      // Calculate coordinate parameters
      const baseLatStored = sectorData.latMin - this.globalLatOffset;
      const baseLonStored = sectorData.lonMin - this.globalLonOffset;

      const latDeltas = sectorData.units.map(
        (u) => u.latInt - sectorData.latMin
      );
      const lonDeltas = sectorData.units.map(
        (u) => u.lonInt - sectorData.lonMin
      );
      const maxLatDelta = Math.max(0, ...latDeltas);
      const maxLonDelta = Math.max(0, ...lonDeltas);
      const bitsLat = this.calculateBitWidth(maxLatDelta);
      const bitsLon = this.calculateBitWidth(maxLonDelta);

      // Create sector entry
      const flags = (1 << 0) | (useList ? 1 << 1 : 0); // bit0=1 (bit-packed), bit1=list mode
      const packed = flags | (bitsLat << 2) | (bitsLon << 7);

      const sectorEntry: SectorEntry = {
        sectorNumber: sectorData.sectorNumber,
        unitCount: sectorData.units.length,
        unitsRelOff: currentRelativeOffset,
        baseLatStored,
        baseLonStored,
        flags: packed,
        bitsLat,
        bitsLon,
      };

      sectorEntries.push(sectorEntry);

      // Create unit data blob
      const unitDataBuffer = this.writeUnitDataBlob(
        sectorData,
        useList,
        bitsLat,
        bitsLon,
        latDeltas,
        lonDeltas
      );
      unitDataBuffers.push(unitDataBuffer);

      currentRelativeOffset += unitDataBuffer.length;
    }

    // Write sector table
    for (const entry of sectorEntries) {
      buffers.push(this.writeSectorEntry(entry));
    }

    // Write unit data
    buffers.push(...unitDataBuffers);

    return Buffer.concat(buffers);
  }

  /**
   * Write sector entry (14 bytes)
   */
  private writeSectorEntry(entry: SectorEntry): Buffer {
    const buffer = Buffer.alloc(14);
    let offset = 0;

    // Sector number (1 byte)
    buffer.writeUInt8(entry.sectorNumber, offset);
    offset += 1;

    // Unit count (2 bytes, u16)
    buffer.writeUInt16LE(entry.unitCount, offset);
    offset += 2;

    // Units relative offset (3 bytes, u24)
    buffer.writeUIntLE(entry.unitsRelOff, offset, 3);
    offset += 3;

    // Base lat stored (3 bytes, i24)
    buffer.writeIntLE(entry.baseLatStored, offset, 3);
    offset += 3;

    // Base lon stored (3 bytes, i24)
    buffer.writeIntLE(entry.baseLonStored, offset, 3);
    offset += 3;

    // Packed flags and bit widths (2 bytes, u16)
    buffer.writeUInt16LE(entry.flags, offset);

    return buffer;
  }

  /**
   * Write unit data blob (bitmap/list + coordinate stream)
   */
  private writeUnitDataBlob(
    sectorData: SectorData,
    useList: boolean,
    bitsLat: number,
    bitsLon: number,
    latDeltas: number[],
    lonDeltas: number[]
  ): Buffer {
    const buffers: Buffer[] = [];

    if (useList) {
      // Unit-list mode: varint sequence
      const indices = sectorData.units.map((u) => u.unitIndex);
      const varintBuffer = VarintUtils.encodeDeltaSequence(indices);
      buffers.push(varintBuffer);
    } else {
      // Bitmap mode: 85 bytes exactly
      const bitmap = Buffer.alloc(85); // 676 bits = 85 bytes

      for (const unit of sectorData.units) {
        const bitIndex = unit.unitIndex;
        const byteIndex = Math.floor(bitIndex / 8);
        const bitOffset = bitIndex % 8;

        if (byteIndex < 85) {
          const currentByte = bitmap[byteIndex];
          if (currentByte !== undefined) {
            bitmap[byteIndex] = currentByte | (1 << bitOffset);
          }
        }
      }

      buffers.push(bitmap);
    }

    // Coordinate stream
    const bitWriter = new BitWriter();

    for (let i = 0; i < sectorData.units.length; i++) {
      const latDelta = latDeltas[i];
      const lonDelta = lonDeltas[i];
      if (latDelta !== undefined && lonDelta !== undefined) {
        bitWriter.writeBits(latDelta, bitsLat);
        bitWriter.writeBits(lonDelta, bitsLon);
      }
    }

    buffers.push(bitWriter.getBuffer());

    return Buffer.concat(buffers);
  }

  /**
   * Create a quick test encoder with sample data (useful for testing)
   */
  static createTestEncoder(records?: PostcodeRecord[]): PostcodeEncoder {
    const defaultRecords: PostcodeRecord[] = [
      { postcode: "M1 1AA", lat: 53.4808, lon: -2.2426 },
      { postcode: "M1 1AB", lat: 53.4809, lon: -2.2427 },
      { postcode: "M1 1AC", lat: 53.481, lon: -2.2428 },
      { postcode: "SW1A 1AA", lat: 51.5014, lon: -0.1419 },
      { postcode: "SW1A 1AB", lat: 51.5015, lon: -0.142 },
      { postcode: "E1 6AN", lat: 51.52, lon: -0.0543 },
      { postcode: "W1A 0AX", lat: 51.5154, lon: -0.1553 },
    ];

    const encoder = new PostcodeEncoder(""); // Empty path for test data
    const testRecords = records || defaultRecords;

    // Pre-populate the encoder with test data
    encoder.processRecords(testRecords);
    encoder.calculateGlobalOffsets();
    encoder.processSectors();

    return encoder;
  }

  /**
   * Get statistics about the encoding
   */
  getStats() {
    let totalUnits = 0;
    for (const outwardData of this.outwardData.values()) {
      for (const sectorData of outwardData.sectors.values()) {
        totalUnits += sectorData.units.length;
      }
    }

    return {
      totalOutwards: this.outwardData.size,
      totalPostcodes: totalUnits,
    };
  }
}
