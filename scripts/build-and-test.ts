import { PostcodeEncoder } from "../src/PostcodeEncoder";
import { PostcodeClient } from "../src/PostcodeClient";
import { readFileSync } from "fs";
import { createReadStream } from "fs";
import { createInterface } from "readline";

interface TestResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  lookupSuccesses: number;
  lookupFailures: number;
  coordinateMismatches: number;
  maxCoordinateError: number;
  averageCoordinateError: number;
  errors: Array<{
    postcode: string;
    issue: string;
    csvLat?: number;
    csvLon?: number;
    dbLat?: number;
    dbLon?: number;
    error?: number;
  }>;
}

/**
 * Calculate the distance between two coordinate points in meters
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCsvLine(line: string): string[] {
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
 * Stream through CSV file and test each postcode lookup
 */
async function testPostcodeLookups(
  csvPath: string,
  client: PostcodeClient
): Promise<TestResult> {
  const result: TestResult = {
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    lookupSuccesses: 0,
    lookupFailures: 0,
    coordinateMismatches: 0,
    maxCoordinateError: 0,
    averageCoordinateError: 0,
    errors: [],
  };

  let totalCoordinateError = 0;
  let coordinateErrorCount = 0;

  const fileStream = createReadStream(csvPath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let isFirstLine = true;

  for await (const line of rl) {
    result.totalRows++;

    // Skip header if present
    if (isFirstLine && line.toLowerCase().includes("postcode")) {
      isFirstLine = false;
      continue;
    }
    isFirstLine = false;

    if (!line.trim()) continue;

    const parts = parseCsvLine(line);
    if (parts.length < 3) {
      result.invalidRows++;
      result.errors.push({
        postcode: parts[0] || "unknown",
        issue: "Invalid CSV format - insufficient columns",
      });
      continue;
    }

    const postcode = parts[0]?.replace(/"/g, "").trim() || "";
    const csvLat = parseFloat(parts[1] || "");
    const csvLon = parseFloat(parts[2] || "");

    if (!postcode || isNaN(csvLat) || isNaN(csvLon)) {
      result.invalidRows++;
      const errorEntry: any = {
        postcode,
        issue: "Invalid data - missing postcode or coordinates",
      };
      if (!isNaN(csvLat)) errorEntry.csvLat = csvLat;
      if (!isNaN(csvLon)) errorEntry.csvLon = csvLon;
      result.errors.push(errorEntry);
      continue;
    }

    result.validRows++;

    // Lookup postcode in binary database
    let lookupResult;
    try {
      lookupResult = client.lookup(postcode);
    } catch (error) {
      console.error(`Error looking up postcode "${postcode}":`, error);
      throw error;
    }

    if (!lookupResult) {
      result.lookupFailures++;
      result.errors.push({
        postcode,
        issue: "Postcode not found in database",
        csvLat,
        csvLon,
      });

      // Log failed lookups for debugging
      if (result.lookupFailures <= 20) {
        console.log(`Failed lookup #${result.lookupFailures}: ${postcode}`);
      }
      continue;
    }

    result.lookupSuccesses++;

    // Compare coordinates
    const distance = calculateDistance(
      csvLat,
      csvLon,
      lookupResult.lat,
      lookupResult.lon
    );

    // Allow for small rounding errors due to quantization (0.0001 degree step = ~11m)
    const tolerance = 15; // meters

    if (distance > tolerance) {
      result.coordinateMismatches++;
      result.errors.push({
        postcode,
        issue: `Coordinate mismatch (${distance.toFixed(2)}m difference)`,
        csvLat,
        csvLon,
        dbLat: lookupResult.lat,
        dbLon: lookupResult.lon,
        error: distance,
      });
    }

    // Track coordinate errors for statistics
    totalCoordinateError += distance;
    coordinateErrorCount++;
    result.maxCoordinateError = Math.max(result.maxCoordinateError, distance);

    // Progress reporting
    if (result.totalRows % 100000 === 0) {
      //   console.log(`Processed ${result.totalRows.toLocaleString()} rows...`);
    }
  }

  result.averageCoordinateError =
    coordinateErrorCount > 0 ? totalCoordinateError / coordinateErrorCount : 0;

  return result;
}

/**
 * Generate a detailed test report
 */
function generateReport(
  result: TestResult,
  buildTime: number,
  testTime: number
): void {
  console.log("\n" + "=".repeat(60));
  console.log("           POSTCODE DATABASE TEST REPORT");
  console.log("=".repeat(60));

  console.log("\n📊 PROCESSING STATISTICS:");
  console.log(
    `   Total rows processed:     ${result.totalRows.toLocaleString()}`
  );
  console.log(
    `   Valid rows:               ${result.validRows.toLocaleString()}`
  );
  console.log(
    `   Invalid rows:             ${result.invalidRows.toLocaleString()}`
  );
  console.log(
    `   Invalid rate:             ${(
      (result.invalidRows / result.totalRows) *
      100
    ).toFixed(2)}%`
  );

  console.log("\n🔍 LOOKUP STATISTICS:");
  console.log(
    `   Successful lookups:       ${result.lookupSuccesses.toLocaleString()}`
  );
  console.log(
    `   Failed lookups:           ${result.lookupFailures.toLocaleString()}`
  );
  console.log(
    `   Lookup success rate:      ${(
      (result.lookupSuccesses / result.validRows) *
      100
    ).toFixed(2)}%`
  );

  console.log("\n📍 COORDINATE ACCURACY:");
  console.log(
    `   Coordinate mismatches:    ${result.coordinateMismatches.toLocaleString()}`
  );
  console.log(
    `   Accuracy rate:            ${(
      ((result.lookupSuccesses - result.coordinateMismatches) /
        result.lookupSuccesses) *
      100
    ).toFixed(2)}%`
  );
  console.log(
    `   Max coordinate error:     ${result.maxCoordinateError.toFixed(2)}m`
  );
  console.log(
    `   Average coordinate error: ${result.averageCoordinateError.toFixed(2)}m`
  );

  console.log("\n⏱️  PERFORMANCE:");
  console.log(`   Build time:               ${buildTime.toFixed(2)}s`);
  console.log(`   Test time:                ${testTime.toFixed(2)}s`);
  console.log(
    `   Total time:               ${(buildTime + testTime).toFixed(2)}s`
  );
  console.log(
    `   Lookup rate:              ${(result.validRows / testTime).toFixed(
      0
    )} lookups/sec`
  );

  // Show first few errors as examples
  if (result.errors.length > 0) {
    console.log("\n❌ ERROR EXAMPLES (first 10):");
    result.errors.slice(0, 10).forEach((error, index) => {
      console.log(`   ${index + 1}. ${error.postcode}: ${error.issue}`);
      if (error.csvLat !== undefined && error.dbLat !== undefined) {
        console.log(`      CSV: ${error.csvLat}, ${error.csvLon}`);
        console.log(`      DB:  ${error.dbLat}, ${error.dbLon}`);
      }
    });

    if (result.errors.length > 10) {
      console.log(`   ... and ${result.errors.length - 10} more errors`);
    }
  }

  console.log("\n" + "=".repeat(60));

  // Overall assessment
  const successRate = (result.lookupSuccesses / result.validRows) * 100;
  const accuracyRate =
    ((result.lookupSuccesses - result.coordinateMismatches) /
      result.lookupSuccesses) *
    100;

  if (successRate >= 99.9 && accuracyRate >= 99.9) {
    console.log(
      "✅ RESULT: EXCELLENT - Database is highly accurate and complete"
    );
  } else if (successRate >= 99.0 && accuracyRate >= 99.0) {
    console.log(
      "✅ RESULT: GOOD - Database has minor issues but is production ready"
    );
  } else if (successRate >= 95.0 && accuracyRate >= 95.0) {
    console.log(
      "⚠️  RESULT: ACCEPTABLE - Database has some issues that should be investigated"
    );
  } else {
    console.log(
      "❌ RESULT: POOR - Database has significant issues and needs attention"
    );
  }

  console.log("=".repeat(60));
}

/**
 * Main test execution
 */
async function main(): Promise<void> {
  const csvPath = "./postcodes.csv";
  const binaryPath = "./postcodes.pcod";

  try {
    console.log("🏗️  Building postcode database...");
    const buildStartTime = Date.now();

    // Build the database
    const encoder = new PostcodeEncoder(csvPath);
    encoder.build(binaryPath);

    const buildTime = (Date.now() - buildStartTime) / 1000;
    console.log(`✅ Build completed in ${buildTime.toFixed(2)}s`);

    console.log("\n🧪 Loading database and starting tests...");
    const testStartTime = Date.now();

    // Load the client
    const client = new PostcodeClient(readFileSync(binaryPath));

    // Run the tests
    console.log("\n🔍 Testing postcode lookups...");
    const testResult = await testPostcodeLookups(csvPath, client);

    const testTime = (Date.now() - testStartTime) / 1000;

    // Generate report
    generateReport(testResult, buildTime, testTime);
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
