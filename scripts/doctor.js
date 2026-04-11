import { getReadinessReport } from "../src/diagnostics.js";

const report = getReadinessReport();

console.log(JSON.stringify(report, null, 2));

if (!report.ready) {
  process.exitCode = 1;
}
