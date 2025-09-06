import {
  PostcodeLookupResult,
  V3Header,
  OutwardIndexEntry,
  SectorEntry,
} from "./types";
import { PostcodeNormalizer } from "./PostcodeNormalizer";
import { BitReader } from "./BitReader";
import { VarintUtils } from "./VarintUtils";

/**
 * PostcodeClient - Loads and queries v3 binary postcode database
 * Implements the complete v3 specification lookup and enumeration functionality
 */
export class PostcodeClient {
  private buffer: Buffer;
  private header: V3Header;
  private outwardIndex: OutwardIndexEntry[] = [];

  constructor(databaseBuffer: Buffer) {
    this.buffer = databaseBuffer;
    this.header = this.parseHeader();
    this.validateHeader();
    this.outwardIndex = this.parseOutwardIndex();
  }

  /**
   * Parse v3 header (32 bytes)
   */
  private parseHeader(): V3Header {
    if (this.buffer.length < 32) {
      throw new Error("Buffer too small to contain v3 header");
    }

    let offset = 0;

    // Magic "PCDB" (4 bytes)
    const magic = this.buffer.toString("ascii", offset, offset + 4);
    offset += 4;

    // Version (1 byte)
    const version = this.buffer.readUInt8(offset);
    offset += 1;

    // Flags (1 byte)
    const flags = this.buffer.readUInt8(offset);
    offset += 1;

    // Outward count (2 bytes, u16)
    const outwardCount = this.buffer.readUInt16LE(offset);
    offset += 2;

    // Total unit count (4 bytes, u32)
    const totalUnitCount = this.buffer.readUInt32LE(offset);
    offset += 4;

    // Lat offset (4 bytes, i32)
    const latOffset = this.buffer.readInt32LE(offset);
    offset += 4;

    // Lon offset (4 bytes, i32)
    const lonOffset = this.buffer.readInt32LE(offset);
    offset += 4;

    // Reserved bytes (12 bytes) - ignored
    return {
      magic,
      version,
      flags,
      outwardCount,
      totalUnitCount,
      latOffset,
      lonOffset,
    };
  }

  /**
   * Validate header fields
   */
  private validateHeader(): void {
    if (this.header.magic !== "PCDB") {
      throw new Error(`Invalid magic: expected PCDB, got ${this.header.magic}`);
    }
    if (this.header.version !== 3) {
      throw new Error(
        `Unsupported version: expected 3, got ${this.header.version}`
      );
    }
    if (this.header.outwardCount <= 0 || this.header.outwardCount > 65535) {
      throw new Error(`Invalid outward count: ${this.header.outwardCount}`);
    }
  }

  /**
   * Parse outward index entries
   */
  private parseOutwardIndex(): OutwardIndexEntry[] {
    const entries: OutwardIndexEntry[] = [];
    let offset = 32; // After header

    for (let i = 0; i < this.header.outwardCount; i++) {
      // Outward code (4 bytes, null-padded)
      const outwardCode = this.buffer
        .toString("ascii", offset, offset + 4)
        .replace(/\0+$/, "");
      offset += 4;

      // Sector count (1 byte)
      const sectorCount = this.buffer.readUInt8(offset);
      offset += 1;

      // Sector index offset (4 bytes, u32)
      const sectorIndexOffset = this.buffer.readUInt32LE(offset);
      offset += 4;

      entries.push({
        outwardCode,
        sectorCount,
        sectorIndexOffset,
      });
    }

    return entries;
  }

  /**
   * Find outward entry by binary search
   */
  private findOutwardEntry(outward: string): OutwardIndexEntry | null {
    let left = 0;
    let right = this.outwardIndex.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.outwardIndex[mid];
      if (!entry) continue;

      const comparison = outward.localeCompare(entry.outwardCode);

      if (comparison === 0) {
        return entry;
      } else if (comparison < 0) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return null;
  }

  /**
   * Read sector table for an outward
   */
  private readSectorTable(outwardEntry: OutwardIndexEntry): SectorEntry[] {
    const sectors: SectorEntry[] = [];
    let offset = outwardEntry.sectorIndexOffset;

    for (let i = 0; i < outwardEntry.sectorCount; i++) {
      // Sector number (1 byte)
      const sectorNumber = this.buffer.readUInt8(offset);
      offset += 1;

      // Unit count (2 bytes, u16)
      const unitCount = this.buffer.readUInt16LE(offset);
      offset += 2;

      // Units relative offset (3 bytes, u24)
      const unitsRelOff = this.buffer.readUIntLE(offset, 3);
      offset += 3;

      // Base lat stored (3 bytes, i24)
      const baseLatStored = this.buffer.readIntLE(offset, 3);
      offset += 3;

      // Base lon stored (3 bytes, i24)
      const baseLonStored = this.buffer.readIntLE(offset, 3);
      offset += 3;

      // Packed flags and bit widths (2 bytes, u16)
      const packed = this.buffer.readUInt16LE(offset);
      offset += 2;

      const flags = packed & 0x3; // bits 0-1
      const bitsLat = (packed >> 2) & 0x1f; // bits 2-6
      const bitsLon = (packed >> 7) & 0x1f; // bits 7-11

      sectors.push({
        sectorNumber,
        unitCount,
        unitsRelOff,
        baseLatStored,
        baseLonStored,
        flags,
        bitsLat,
        bitsLon,
      });
    }

    return sectors;
  }

  /**
   * Find sector entry by sector number
   */
  private findSectorEntry(
    sectors: SectorEntry[],
    sectorNumber: number
  ): SectorEntry | null {
    return sectors.find((s) => s.sectorNumber === sectorNumber) || null;
  }

  /**
   * Check if unit exists in bitmap mode
   */
  private checkBitmapUnit(
    outwardEntry: OutwardIndexEntry,
    sectorEntry: SectorEntry,
    unitIndex: number
  ): { exists: boolean; rank?: number } {
    const unitsOffset =
      outwardEntry.sectorIndexOffset + sectorEntry.unitsRelOff;

    // Read bitmap (85 bytes exactly)
    const bitmap = this.buffer.subarray(unitsOffset, unitsOffset + 85);

    // Check if bit is set
    const byteIndex = Math.floor(unitIndex / 8);
    const bitIndex = unitIndex % 8;

    if (byteIndex >= 85) {
      return { exists: false };
    }

    const byte = bitmap[byteIndex];
    if (byte === undefined) {
      return { exists: false };
    }
    const bitSet = (byte & (1 << bitIndex)) !== 0;

    if (!bitSet) {
      return { exists: false };
    }

    // Calculate rank (population count of bits before this one)
    let rank = 0;

    // Count bits in complete bytes before target byte
    for (let i = 0; i < byteIndex; i++) {
      const b = bitmap[i];
      if (b !== undefined) {
        rank += this.popcount8(b);
      }
    }

    // Count bits in target byte before target bit
    const mask = (1 << bitIndex) - 1;
    if (byte !== undefined) {
      rank += this.popcount8(byte & mask);
    }

    return { exists: true, rank };
  }

  /**
   * Find unit in list mode
   */
  private findListUnit(
    outwardEntry: OutwardIndexEntry,
    sectorEntry: SectorEntry,
    unitIndex: number
  ): { exists: boolean; rank?: number; streamStart?: number } {
    const unitsOffset =
      outwardEntry.sectorIndexOffset + sectorEntry.unitsRelOff;

    // Decode varint sequence
    const { values, bytesRead } = VarintUtils.decodeDeltaSequence(
      this.buffer,
      unitsOffset,
      sectorEntry.unitCount
    );

    // Binary search for unit index
    let left = 0;
    let right = values.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const value = values[mid];
      if (value === undefined) continue;

      if (value === unitIndex) {
        return {
          exists: true,
          rank: mid,
          streamStart: unitsOffset + bytesRead,
        };
      } else if (value < unitIndex) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return { exists: false };
  }

  /**
   * Read coordinate record from bit-packed stream
   */
  private readCoordinateRecord(
    streamStart: number,
    rank: number,
    bitsLat: number,
    bitsLon: number
  ): { latDelta: number; lonDelta: number } {
    const bitOffset = rank * (bitsLat + bitsLon);
    const bitReader = new BitReader(this.buffer, streamStart * 8 + bitOffset);

    const latDelta = bitReader.readBits(bitsLat);
    const lonDelta = bitReader.readBits(bitsLon);

    return { latDelta, lonDelta };
  }

  /**
   * Population count for 8-bit value
   */
  private popcount8(value: number): number {
    let count = 0;
    while (value) {
      count++;
      value &= value - 1;
    }
    return count;
  }

  /**
   * Main lookup method - find coordinates for a postcode
   */
  lookup(postcode: string): PostcodeLookupResult | null {
    // Parse and normalize postcode
    const parsed = PostcodeNormalizer.parsePostcode(postcode);
    if (!parsed) {
      return null;
    }

    // Find outward
    const outwardEntry = this.findOutwardEntry(parsed.outward);
    if (!outwardEntry) {
      return null;
    }

    // Read sector table
    const sectors = this.readSectorTable(outwardEntry);

    // Find sector
    const sectorEntry = this.findSectorEntry(sectors, parsed.sector);
    if (!sectorEntry) {
      return null;
    }

    // Check unit existence and get rank
    const isListMode = (sectorEntry.flags & 0x2) !== 0;
    let rank: number;
    let streamStart: number;

    if (isListMode) {
      const result = this.findListUnit(
        outwardEntry,
        sectorEntry,
        parsed.unitIndex
      );
      if (
        !result.exists ||
        result.rank === undefined ||
        result.streamStart === undefined
      ) {
        return null;
      }
      rank = result.rank;
      streamStart = result.streamStart;
    } else {
      const result = this.checkBitmapUnit(
        outwardEntry,
        sectorEntry,
        parsed.unitIndex
      );
      if (!result.exists || result.rank === undefined) {
        return null;
      }
      rank = result.rank;
      streamStart =
        outwardEntry.sectorIndexOffset + sectorEntry.unitsRelOff + 85; // After bitmap
    }

    // Read coordinate record
    const bitsLat = sectorEntry.bitsLat ?? 8; // Default to 8 bits if not specified
    const bitsLon = sectorEntry.bitsLon ?? 8; // Default to 8 bits if not specified

    const { latDelta, lonDelta } = this.readCoordinateRecord(
      streamStart,
      rank,
      bitsLat,
      bitsLon
    );

    // Reconstruct coordinates
    const latStored = sectorEntry.baseLatStored + latDelta;
    const lonStored = sectorEntry.baseLonStored + lonDelta;

    const lat = (latStored + this.header.latOffset) / 100000;
    const lon = (lonStored + this.header.lonOffset) / 100000;

    return {
      postcode: postcode, // Use the original postcode parameter instead of parsed.normalized
      outward: parsed.outward,
      lat,
      lon,
    };
  }

  /**
   * Enumerate all postcodes in an outward
   */
  enumerateOutward(outward: string): PostcodeLookupResult[] {
    const outwardEntry = this.findOutwardEntry(outward.toUpperCase());
    if (!outwardEntry) {
      return [];
    }

    const results: PostcodeLookupResult[] = [];
    const sectors = this.readSectorTable(outwardEntry);

    for (const sectorEntry of sectors) {
      const sectorResults = this.enumerateSector(outwardEntry, sectorEntry);
      results.push(...sectorResults);
    }

    return results;
  }

  /**
   * Enumerate all postcodes in a sector
   */
  private enumerateSector(
    outwardEntry: OutwardIndexEntry,
    sectorEntry: SectorEntry
  ): PostcodeLookupResult[] {
    const results: PostcodeLookupResult[] = [];
    const isListMode = (sectorEntry.flags & 0x2) !== 0;

    if (isListMode) {
      // List mode: decode varint sequence
      const unitsOffset =
        outwardEntry.sectorIndexOffset + sectorEntry.unitsRelOff;
      const { values, bytesRead } = VarintUtils.decodeDeltaSequence(
        this.buffer,
        unitsOffset,
        sectorEntry.unitCount
      );

      const streamStart = unitsOffset + bytesRead;

      for (let rank = 0; rank < values.length; rank++) {
        const unitIndex = values[rank];
        if (unitIndex === undefined) continue;

        const unit = PostcodeNormalizer.indexToUnit(unitIndex);
        const postcode = `${outwardEntry.outwardCode} ${sectorEntry.sectorNumber}${unit}`;

        const bitsLat = sectorEntry.bitsLat ?? 8;
        const bitsLon = sectorEntry.bitsLon ?? 8;
        const { latDelta, lonDelta } = this.readCoordinateRecord(
          streamStart,
          rank,
          bitsLat,
          bitsLon
        );

        const latStored = sectorEntry.baseLatStored + latDelta;
        const lonStored = sectorEntry.baseLonStored + lonDelta;

        const lat = (latStored + this.header.latOffset) / 100000;
        const lon = (lonStored + this.header.lonOffset) / 100000;

        results.push({
          postcode,
          outward: outwardEntry.outwardCode,
          lat,
          lon,
        });
      }
    } else {
      // Bitmap mode: scan all possible unit indices
      const unitsOffset =
        outwardEntry.sectorIndexOffset + sectorEntry.unitsRelOff;
      const bitmap = this.buffer.subarray(unitsOffset, unitsOffset + 85);
      const streamStart = unitsOffset + 85;

      let rank = 0;

      for (let unitIndex = 0; unitIndex < 676; unitIndex++) {
        const byteIndex = Math.floor(unitIndex / 8);
        const bitIndex = unitIndex % 8;

        if (byteIndex >= 85) break;

        const byte = bitmap[byteIndex];
        if (byte === undefined) continue;
        const bitSet = (byte & (1 << bitIndex)) !== 0;

        if (bitSet) {
          const unit = PostcodeNormalizer.indexToUnit(unitIndex);
          const postcode = `${outwardEntry.outwardCode} ${sectorEntry.sectorNumber}${unit}`;

          const bitsLat = sectorEntry.bitsLat ?? 8;
          const bitsLon = sectorEntry.bitsLon ?? 8;
          const { latDelta, lonDelta } = this.readCoordinateRecord(
            streamStart,
            rank,
            bitsLat,
            bitsLon
          );

          const latStored = sectorEntry.baseLatStored + latDelta;
          const lonStored = sectorEntry.baseLonStored + lonDelta;

          const lat = (latStored + this.header.latOffset) / 100000;
          const lon = (lonStored + this.header.lonOffset) / 100000;

          results.push({
            postcode,
            outward: outwardEntry.outwardCode,
            lat,
            lon,
          });

          rank++;
        }
      }
    }

    return results;
  }

  /**
   * Get list of all outward codes
   */
  getOutwardList(): string[] {
    return this.outwardIndex.map((entry) => entry.outwardCode).sort();
  }

  /**
   * Find outward codes matching a prefix
   */
  findNearbyOutwards(prefix: string): string[] {
    const upperPrefix = prefix.toUpperCase();
    return this.getOutwardList().filter((outward) =>
      outward.startsWith(upperPrefix)
    );
  }

  /**
   * Check if a postcode exists in the database
   */
  isValidPostcode(postcode: string): boolean {
    return this.lookup(postcode) !== null;
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      totalOutwards: this.header.outwardCount,
      totalPostcodes: this.header.totalUnitCount,
      fileSize: this.buffer.length,
    };
  }
}
