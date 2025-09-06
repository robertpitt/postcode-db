# UK Postcode Binary Encoder

This project implements an ultra-compact binary format for UK postcode geolocation data, achieving <10MB file size for ~2.7M postcodes with O(1) exact lookups and efficient prefix queries.

## Architecture

The implementation is split into focused, reusable classes:

### Core Classes

- **`PostcodeEncoder`** - Main orchestrator class that coordinates the encoding process
- **`PostcodeNormalizer`** - Handles postcode validation, normalization, and inward ID encoding
- **`BitmapManager`** - Manages 4000-bit presence bitmaps and rank directories for each outward
- **`BinaryFileWriter`** - Handles the binary file format layout and writing
- **`BitWriter`** - Utility for bit-packing coordinate deltas

### Key Features

- **Compact Format**: Uses quantized coordinates (1e-4° precision) and bit-packed deltas
- **Fast Lookups**: O(1) exact postcode lookup via bitmap + rank directory + bit extraction
- **Prefix Queries**: Efficient enumeration of all postcodes in an outward (e.g., "ST6")
- **Memory Mappable**: File format designed for direct memory mapping
- **Type Safe**: Full TypeScript implementation with comprehensive error handling

## Usage

### Encoding (CSV to Binary)

```typescript
import { PostcodeEncoder } from "./src/PostcodeEncoder";

const encoder = new PostcodeEncoder("postcodes.csv");
encoder.build("postcodes.bin");
```

### Querying (Binary Database)

```typescript
import * as fs from "fs";
import { PostcodeClient } from "./src/PostcodeClient";

// Load the binary database
const buffer = fs.readFileSync("postcodes.pcod");
const client = new PostcodeClient(buffer);

// Exact postcode lookup (O(1))
const result = client.lookup("ST6 5AA");
if (result) {
  console.log(`${result.postcode}: ${result.lat}, ${result.lon}`);
}

// Enumerate all postcodes in an outward (prefix query)
const postcodes = client.enumerateOutward("ST6");
console.log(`Found ${postcodes.length} postcodes in ST6`);

// Get database statistics
const stats = client.getStats();
console.log(
  `Database: ${stats.totalPostcodes} postcodes, ${stats.fileSize} bytes`
);

// Check if postcode exists
const isValid = client.isValidPostcode("M1 1AA");

// Find outwards by prefix
const manchesterOutwards = client.findNearbyOutwards("M");
```

### Dataset

This project uses the ONS Postcode Database that can be downlaod from https://geoportal.statistics.gov.uk/datasets/e14b1475ecf74b58804cf667b6740706, Once you have downloaded the dataset you can put the full `ONS_{month}_{year}_UK.csv` file in the data/ directory and run the following command
to extract just the valid postcodes, lat and long values into a file called `postcodes.csv`, this file is what you can then use to build the binary database

### Building the Database

1. Ensure that you have a file called postcodes.csv in the root directory, it should contain 3 columns only
2. Execute the `yarn run build` command, you should see an output like `{ totalOutwards: 2943, totalPostcodes: 1790884, fileSize: 6509848 }` and a new file called `postcodes.pcod` apear in the root of the directory.

## Performance

Below is the output on a Mac Pro M3 for the script `yarn ts-node scripts/build-and-test.ts`, this builds a postcode database from the postcodes.csv, and then loads that into the client and then tests every postcode in the CSV against the binary file, ensuring that every postcode is successfully index

```
🏗️  Building postcode database...
✅ Build completed in 1.65s

🧪 Loading database and starting tests...

🔍 Testing postcode lookups...

============================================================
           POSTCODE DATABASE TEST REPORT
============================================================

📊 PROCESSING STATISTICS:
   Total rows processed:     1,790,884
   Valid rows:               1,790,884
   Invalid rows:             0
   Invalid rate:             0.00%

🔍 LOOKUP STATISTICS:
   Successful lookups:       1,790,884
   Failed lookups:           0
   Lookup success rate:      100.00%

📍 COORDINATE ACCURACY:
   Coordinate mismatches:    0
   Accuracy rate:            100.00%
   Max coordinate error:     0.66m
   Average coordinate error: 0.35m

⏱️  PERFORMANCE:
   Build time:               1.65s
   Test time:                1.95s
   Total time:               3.59s
   Lookup rate:              920763 lookups/sec
```

## File Format

```
+======================================================================================+
|                                    PCDB v3 FILE                                      |
+======================================================================================+
|                                   HEADER (32 bytes)                                  |
| 0x00  magic: 'PCDB' (char[4])                                                        |
| 0x04  version: u8 (=3)                                                               |
| 0x05  flags:   u8 (=0)                                                               |
| 0x06  outwardCount: u16                                                              |
| 0x08  totalUnitCount: u32                                                            |
| 0x0C  latOffset: i32  (global min latInt)                                            |
| 0x10  lonOffset: i32  (global min lonInt)                                            |
| 0x14  reserved[12] (zeros)                                                           |
+======================================================================================+
|                           OUTWARD INDEX TABLE (9 bytes x outwardCount)               |
|                                                                                      |
|  Entry i (9 bytes):                                                                  |
|    +--------------------------------------+                                          |
|    | outwardCode: char[4] (ASCII, NUL-pad) |                                          |
|    | sectorCount: u8                      |                                          |
|    | sectorIndexOffset: u32 (ABSOLUTE) ---+-----> points to start of Outward Block i |
|    +--------------------------------------+                                          |
|                                                                                      |
+======================================================================================+
|                                   OUTWARD BLOCK i (variable)                         |
|                        (begins at index[i].sectorIndexOffset, ABSOLUTE)              |
|                                                                                      |
|  +--------------------------------------------------------------------------------+  |
|  | SECTOR TABLE (14 bytes x sectorCount)                                          |  |
|  |                                                                                |  |
|  |  SectorEntry s (14 bytes):                                                     |  |
|  |    +-----------------------------------------------------------------------+   |  |
|  |    | sectorNumber : u8        (0..9)                                       |   |  |
|  |    | unitCount    : u16                                                   |   |  |
|  |    | unitsRelOff  : u24 (LE)  -------------------------------+------------+   |  |
|  |    |                               (RELATIVE to Outward Block|start)          |  |
|  |    | baseLatStored: i24 (LE) = sector.latMin - header.latOffset            |   |  |
|  |    | baseLonStored: i24 (LE) = sector.lonMin - header.lonOffset            |   |  |
|  |    | flagsAndBits : u16 (LE)                                              |   |  |
|  |    |    bit0      = 1  (coordinates are bit-packed)                       |   |  |
|  |    |    bit1      = 1:list mode | 0:bitmap mode                           |   |  |
|  |    |    bits2..6  = bitsLat (5 bits)                                      |   |  |
|  |    |    bits7..15 = bitsLon (9 bits)                                      |   |  |
|  |    +-----------------------------------------------------------------------+   |  |
|  +--------------------------------------------------------------------------------+  |
|                                                                                      |
|  +--------------------------------------------------------------------------------+  |
|  | UNIT DATA BLOBS (concatenated, one per sector, same order as sector table)     |  |
|  |                                                                                |  |
|  |  Blob for SectorEntry s at: (OutwardBlockStart + unitsRelOff[s])               |  |
|  |    +-----------------------------+   immediately followed by   +-------------+ |  |
|  |    | UNIT PRESENCE               |---------------------------->| COORD STREAM | |  |
|  |    +-----------------------------+                              +-------------+ |  |
|  |                                                                                |  |
|  |    UNIT PRESENCE (choose ONE):                                                 |  |
|  |      * Bitmap mode: EXACTLY 85 bytes (680 bits). Bit set => unitIndex present. |  |
|  |        byte = unitIndex/8, bit = unitIndex%8.                                  |  |
|  |      * List mode: Varint sequence of unit indices using delta coding:          |  |
|  |          first value = absolute first unitIndex (varint)                       |  |
|  |          subsequent values = delta to previous index (varint)                  |  |
|  |        (Encoder picks list if total varint bytes < 85)                         |  |
|  |                                                                                |  |
|  |    COORD STREAM (bit-packed, no per-value padding):                            |  |
|  |      For each of unitCount units (in ascending unitIndex order):               |  |
|  |        write latDelta : unsigned, width = bitsLat                              |  |
|  |        write lonDelta : unsigned, width = bitsLon                              |  |
|  |      Total length = ceil(unitCount x (bitsLat + bitsLon) / 8) bytes            |  |
|  |                                                                                |  |
|  |    Reconstruct per unit:                                                       |  |
|  |      latInt = header.latOffset + baseLatStored + latDelta                      |  |
|  |      lonInt = header.lonOffset + baseLonStored + lonDelta                      |  |
|  |      lat = latInt / 100000.0                                                   |  |
|  |      lon = lonInt / 100000.0                                                   |  |
|  +--------------------------------------------------------------------------------+  |
|                                                                                      |
+======================================================================================+
|                                   OUTWARD BLOCK i+1 ... (repeat)                     |
+======================================================================================+
```

## LEGEND / NOTES

- All multi-byte integers are LITTLE-ENDIAN.
- Coordinates are quantized: lat/lon x 100000 -> integer (latInt/lonInt).
- Ordering:
  - Outwards sorted lexicographically
  - Sectors sorted by sectorNumber (0-9)
  - Units sorted by unitIndex (ascending)
- Offsets:
  - sectorIndexOffset is ABSOLUTE (file offset).
  - unitsRelOff is RELATIVE to the start of its Outward Block (i.e., sector table start).
- Capacity:
  - Bitmap presence uses 85 bytes = 680 bits (code implements 680 bits).
- bitsLat/bitsLon are minimal widths for sector-local deltas:
  - latDelta = unit.latInt - sector.latMin
  - lonDelta = unit.lonInt - sector.lonMin
