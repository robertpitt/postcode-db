import { PostcodeEncoder } from "../src/PostcodeEncoder";
import { PostcodeClient } from "../src/PostcodeClient";
import { readFileSync } from "fs";

/**
 * Builds the postcode database from the CSV file containing the following columns:
 * - postcode
 * - latitude
 * - longitude
 */
(async () => {
  const enc = new PostcodeEncoder("./postcodes.csv");
  enc.build("./postcodes.pcod");

  const client = new PostcodeClient(readFileSync("./postcodes.pcod"));

  console.log(client.getStats());
})();
