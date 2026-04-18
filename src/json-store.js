import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

const fileWriteQueues = new Map();
let pool = null;
let initPromise = null;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return String(value || "").trim();
}

function resolveDataDir() {
  return process.env.CLAW_DATA_DIR
    ? path.resolve(process.cwd(), process.env.CLAW_DATA_DIR)
    : config.dataDir;
}

function resolveFilePath(fileNames, name) {
  return path.join(resolveDataDir(), fileNames[name]);
}

function fileQueueKey(namespace, name) {
  return `${namespace}:${name}`;
}

export function hasDatabaseStorage() {
  return Boolean(cleanText(config.databaseUrl));
}

function isLocalDatabaseHost(hostname = "") {
  const value = cleanText(hostname).toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function resolveSslOption() {
  const mode = cleanText(config.databaseSsl).toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "off") {
    return false;
  }
  if (mode === "require" || mode === "true" || mode === "on") {
    return { rejectUnauthorized: false };
  }

  try {
    const url = new URL(config.databaseUrl);
    return isLocalDatabaseHost(url.hostname)
      ? false
      : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

function getPool() {
  if (!hasDatabaseStorage()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: resolveSslOption(),
      max: 10
    });
  }

  return pool;
}

async function ensureDatabaseReady() {
  if (!hasDatabaseStorage()) {
    return false;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS app_json_store (
            namespace TEXT NOT NULL,
            name TEXT NOT NULL,
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (namespace, name)
          )
        `);
      } finally {
        client.release();
      }
      return true;
    })();
  }

  return initPromise;
}

async function ensureLocalFiles(fileNames, defaults) {
  await mkdir(resolveDataDir(), { recursive: true });

  await Promise.all(
    Object.keys(fileNames).map(async (name) => {
      const target = resolveFilePath(fileNames, name);
      try {
        await readFile(target, "utf8");
      } catch {
        await writeFile(
          target,
          `${JSON.stringify(cloneValue(defaults[name]), null, 2)}\n`,
          "utf8"
        );
      }
    })
  );
}

async function readLocalJson(fileNames, defaults, name) {
  await ensureLocalFiles(fileNames, defaults);
  try {
    const content = await readFile(resolveFilePath(fileNames, name), "utf8");
    return JSON.parse(content);
  } catch {
    return cloneValue(defaults[name]);
  }
}

async function writeLocalJson(fileNames, defaults, name, data) {
  await ensureLocalFiles(fileNames, defaults);
  await writeFile(
    resolveFilePath(fileNames, name),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
  return data;
}

async function withLocalWriteLock(namespace, fileNames, defaults, name, updater) {
  const key = fileQueueKey(namespace, name);
  const previous = fileWriteQueues.get(key) || Promise.resolve();
  const next = previous.then(async () => {
    const current = await readLocalJson(fileNames, defaults, name);
    const updated = (await updater(current)) ?? current;
    return writeLocalJson(fileNames, defaults, name, updated);
  });

  fileWriteQueues.set(key, next.catch(() => undefined));
  return next;
}

async function seedDatabaseRow(namespace, name, defaultValue, fileNames, defaults) {
  const initial =
    fileNames[name] ? await readLocalJson(fileNames, defaults, name) : cloneValue(defaultValue);

  await getPool().query(
    `
      INSERT INTO app_json_store (namespace, name, data, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (namespace, name) DO NOTHING
    `,
    [namespace, name, JSON.stringify(initial)]
  );
}

async function readDatabaseJson(namespace, fileNames, defaults, name) {
  await ensureDatabaseReady();
  await seedDatabaseRow(namespace, name, defaults[name], fileNames, defaults);

  const result = await getPool().query(
    `SELECT data FROM app_json_store WHERE namespace = $1 AND name = $2`,
    [namespace, name]
  );

  return result.rows[0]?.data ?? cloneValue(defaults[name]);
}

async function writeDatabaseJson(namespace, name, data) {
  await ensureDatabaseReady();
  await getPool().query(
    `
      INSERT INTO app_json_store (namespace, name, data, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (namespace, name)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `,
    [namespace, name, JSON.stringify(data)]
  );
  return data;
}

async function withDatabaseWriteLock(namespace, fileNames, defaults, name, updater) {
  await ensureDatabaseReady();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    let result = await client.query(
      `
        SELECT data
        FROM app_json_store
        WHERE namespace = $1 AND name = $2
        FOR UPDATE
      `,
      [namespace, name]
    );

    if (!result.rows.length) {
      const initial = fileNames[name]
        ? await readLocalJson(fileNames, defaults, name)
        : cloneValue(defaults[name]);

      await client.query(
        `
          INSERT INTO app_json_store (namespace, name, data, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW())
        `,
        [namespace, name, JSON.stringify(initial)]
      );

      result = await client.query(
        `
          SELECT data
          FROM app_json_store
          WHERE namespace = $1 AND name = $2
          FOR UPDATE
        `,
        [namespace, name]
      );
    }

    const current = result.rows[0]?.data ?? cloneValue(defaults[name]);
    const updated = (await updater(current)) ?? current;

    await client.query(
      `
        UPDATE app_json_store
        SET data = $3::jsonb,
            updated_at = NOW()
        WHERE namespace = $1 AND name = $2
      `,
      [namespace, name, JSON.stringify(updated)]
    );

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createJsonStore({ namespace, defaults, fileNames }) {
  if (!namespace) {
    throw new Error("JSON store namespace is required.");
  }

  const clonedDefaults = Object.fromEntries(
    Object.entries(defaults).map(([name, value]) => [name, cloneValue(value)])
  );

  return {
    async ensureFiles() {
      if (hasDatabaseStorage()) {
        await ensureDatabaseReady();
        await Promise.all(
          Object.keys(fileNames).map((name) =>
            seedDatabaseRow(namespace, name, clonedDefaults[name], fileNames, clonedDefaults)
          )
        );
        return;
      }

      await ensureLocalFiles(fileNames, clonedDefaults);
    },

    async readJson(name) {
      if (!(name in clonedDefaults)) {
        throw new Error(`Unknown JSON store key: ${name}`);
      }

      return hasDatabaseStorage()
        ? readDatabaseJson(namespace, fileNames, clonedDefaults, name)
        : readLocalJson(fileNames, clonedDefaults, name);
    },

    async writeJson(name, data) {
      if (!(name in clonedDefaults)) {
        throw new Error(`Unknown JSON store key: ${name}`);
      }

      return hasDatabaseStorage()
        ? writeDatabaseJson(namespace, name, data)
        : writeLocalJson(fileNames, clonedDefaults, name, data);
    },

    async withWriteLock(name, updater) {
      if (!(name in clonedDefaults)) {
        throw new Error(`Unknown JSON store key: ${name}`);
      }

      return hasDatabaseStorage()
        ? withDatabaseWriteLock(namespace, fileNames, clonedDefaults, name, updater)
        : withLocalWriteLock(namespace, fileNames, clonedDefaults, name, updater);
    }
  };
}
