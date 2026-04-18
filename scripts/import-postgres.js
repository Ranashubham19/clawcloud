import { config } from "../src/config.js";
import { hasDatabaseStorage } from "../src/json-store.js";
import { initStore } from "../src/store.js";
import { initSaasStore } from "../src/saas-store.js";

async function main() {
  if (!hasDatabaseStorage()) {
    throw new Error(
      "DATABASE_URL is required before running db:import. Set DATABASE_URL and try again."
    );
  }

  await initStore();
  await initSaasStore();

  console.log("PostgreSQL JSON storage is ready.");
  console.log(`Database URL configured: ${config.databaseUrl ? "yes" : "no"}`);
  console.log(
    "Any missing database rows were automatically seeded from existing local JSON files."
  );
}

main().catch((error) => {
  console.error("[db:import]", error.message);
  process.exitCode = 1;
});
