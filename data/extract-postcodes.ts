import * as fs from "fs";
import { createReadStream, createWriteStream } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";

/**
 * The purpose of this script is to process the ONSPD raw data and extract a clean list of postcodes, the
 * script will extract out the postcode, latitude and longitude columns, but will also filter out any records
 * that have a date of termination set or invalid lat/long coordinates (99.999999,0.000000).
 */

const INPUT_FILE = resolve(__dirname, "../data/ONSPD_FEB_2025_UK.csv");
const OUTPUT_FILE = resolve(__dirname, "../postcodes.csv");

/**
 * Column Pointers
 */
const PCD_COLUMN = 0;
const DOTERM_COLUMN = 4;
const LAT_COLUMN = 41;
const LONG_COLUMN = 42;

interface PostcodeRecord {
  postcode: string;
  lat: number;
  long: number;
}

function parseCSVLine(line: string): string[] {
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

  // Add the last field
  result.push(current.trim());

  return result;
}

function isValidRecord(fields: string[]): boolean {
  // Check if doterm is empty (no termination date)
  const doterm = fields[DOTERM_COLUMN];
  if (doterm && doterm !== '""' && doterm !== "") {
    return false;
  }

  // Get lat/long as strings
  const latStr = fields[LAT_COLUMN]?.replace(/"/g, "");
  const longStr = fields[LONG_COLUMN]?.replace(/"/g, "");

  // Filter out clearly wrong coordinates
  if (latStr === "99.999999" && longStr === "0.000000") {
    return false;
  }

  // Check for empty coordinates
  if (!latStr || !longStr) {
    return false;
  }

  return true;
}

function cleanPostcode(postcode: string): string {
  // Remove quotes and normalize spacing
  return postcode.replace(/"/g, "").trim().toUpperCase();
}

async function extractPostcodes(): Promise<void> {
  console.log("Starting postcode CSV rebuild...");
  console.log(`Input file: ${INPUT_FILE}`);
  console.log(`Output file: ${OUTPUT_FILE}`);

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Input file not found: ${INPUT_FILE}`);
  }

  const fileStream = createReadStream(INPUT_FILE);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const outputStream = createWriteStream(OUTPUT_FILE);

  let lineCount = 0;
  let validRecords = 0;
  let filteredOut = 0;
  let isFirstLine = true;

  for await (const line of rl) {
    lineCount++;

    // Skip header line
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }

    try {
      const fields = parseCSVLine(line);

      if (
        fields.length <
        Math.max(PCD_COLUMN, DOTERM_COLUMN, LAT_COLUMN, LONG_COLUMN) + 1
      ) {
        console.warn(`Line ${lineCount}: Insufficient fields, skipping`);
        filteredOut++;
        continue;
      }

      if (!isValidRecord(fields)) {
        filteredOut++;
        continue;
      }

      const postcode = cleanPostcode(fields[PCD_COLUMN]!);
      const lat = fields[LAT_COLUMN]?.replace(/"/g, "");
      const long = fields[LONG_COLUMN]?.replace(/"/g, "");

      if (!postcode) {
        filteredOut++;
        continue;
      }

      // Write in the format: postcode,lat,long (no quotes)
      outputStream.write(`${postcode},${lat},${long}\n`);
      validRecords++;

      if (validRecords % 100000 === 0) {
        console.log(`Processed ${validRecords} valid records...`);
      }
    } catch (error) {
      console.warn(`Line ${lineCount}: Parse error, skipping - ${error}`);
      filteredOut++;
    }
  }

  outputStream.end();

  console.log("\nRebuild complete!");
  console.log(`Total lines processed: ${lineCount - 1}`); // -1 for header
  console.log(`Valid records written: ${validRecords}`);
  console.log(`Records filtered out: ${filteredOut}`);
  console.log(`Output file: ${OUTPUT_FILE}`);
}

// Run the script
if (require.main === module) {
  extractPostcodes()
    .then(() => {
      console.log("Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}
