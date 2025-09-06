import { ParsedPostcode } from "./types";

/**
 * PostcodeNormalizer - Handles postcode parsing and normalization
 */
export class PostcodeNormalizer {
  // Unit characters A-Z (26 characters) as per v3.md specification
  private static readonly UNIT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  /**
   * Parse a postcode string into its components
   */
  static parsePostcode(postcode: string): ParsedPostcode | null {
    if (!postcode) return null;

    // Remove all spaces and convert to uppercase
    const normalized = postcode.toUpperCase().replace(/\s+/g, "");

    // Must be at least 4 characters (shortest is like "M11AA")
    if (normalized.length < 4) return null;

    // Always take last 3 characters as inward, everything else as outward
    const inward = normalized.slice(-3);
    const outward = normalized.slice(0, -3);

    if (!outward || !inward || inward.length !== 3) return null;

    return this.parseComponents(outward, inward);
  }

  private static parseComponents(
    outward: string,
    inward: string
  ): ParsedPostcode | null {
    // Extract sector (first digit of inward)
    const sectorChar = inward.charAt(0);
    const sector = parseInt(sectorChar, 10);
    if (isNaN(sector)) return null;

    // Extract unit (last two characters of inward)
    const unit = inward.slice(1);

    // Convert unit to index
    const unitIndex = this.unitToIndex(unit);
    if (unitIndex === -1) return null;

    return {
      outward,
      sector,
      unitIndex,
    };
  }

  /**
   * Convert unit string to index (0-1295)
   */
  private static unitToIndex(unit: string): number {
    if (unit.length !== 2) return -1;

    const firstChar = unit[0];
    const secondChar = unit[1];

    if (!firstChar || !secondChar) return -1;

    const firstIndex = this.UNIT_CHARS.indexOf(firstChar);
    const secondIndex = this.UNIT_CHARS.indexOf(secondChar);

    if (firstIndex === -1 || secondIndex === -1) return -1;

    return firstIndex * 26 + secondIndex;
  }

  /**
   * Convert index back to unit string
   */
  static indexToUnit(index: number): string {
    if (index < 0 || index >= 676) return "";

    const firstIndex = Math.floor(index / 26);
    const secondIndex = index % 26;

    const firstChar = this.UNIT_CHARS[firstIndex];
    const secondChar = this.UNIT_CHARS[secondIndex];

    if (!firstChar || !secondChar) return "";

    return firstChar + secondChar;
  }
}
