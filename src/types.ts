/**
 * Type definitions for the v3 postcode database format
 */

export interface PostcodeRecord {
  postcode: string;
  lat: number;
  lon: number;
}

export interface ParsedPostcode {
  outward: string;
  sector: number;
  unitIndex: number;
  normalized?: string;
}

export interface PostcodeLookupResult {
  postcode: string;
  lat: number;
  lon: number;
  outward?: string;
}

export interface UnitData {
  unitIndex: number;
  latInt: number;
  lonInt: number;
}

export interface SectorData {
  sectorNumber: number;
  units: UnitData[];
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface OutwardData {
  outward: string;
  outwardCode?: string;
  sectors: Map<number, SectorData>;
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
}

export interface V3Header {
  magic: string;
  version: number;
  flags: number;
  outwardCount: number;
  totalUnitCount: number;
  globalLatOffset?: number;
  globalLonOffset?: number;
  latOffset: number;
  lonOffset: number;
  reserved?: number[];
}

export interface OutwardIndexEntry {
  outwardCode: string;
  sectorCount: number;
  unitCount?: number;
  dataOffset?: number;
  sectorIndexOffset: number;
}

export interface SectorEntry {
  sectorNumber: number;
  unitCount: number;
  coordinateMode?: number;
  unitDataOffset?: number;
  coordinateDataOffset?: number;
  unitsRelOff: number;
  baseLatStored: number;
  baseLonStored: number;
  flags: number;
  bitsLat?: number;
  bitsLon?: number;
}

export interface CompressionConfig {
  enabled?: boolean;
  level?: number;
  windowLog?: number;
  hashLog?: number;
  chainLog?: number;
  searchLog?: number;
  minMatch?: number;
  targetLength?: number;
  strategy?: number;
  dictionary?: Buffer;
  dictionarySize?: number;
}
