import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

const fileWriteQueues = new Map();
let pool = null;
let poolSignature = "";
let initPromise = null;
let activeSslOption;
let databaseDisabled = false;

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
  return Boolean(cleanText(config.databaseUrl)) && !databaseDisabled;
}

function isDatabaseConfigured() {
  return Boolean(cleanText(config.databaseUrl));
}

export function getDatabaseStorageStatus() {
  return {
    configured: isDatabaseConfigured(),
    active: hasDatabaseStorage(),
    fallbackToLocal: databaseDisabled,
    mode: hasDatabaseStorage() ? "postgres" : "json"
  };
}

function disableDatabaseStorage(error) {
  if (databaseDisabled) {
    return;
  }

  databaseDisabled = true;
  activeSslOption = undefined;
  initPromise = null;
  void resetPool();
  console.warn(
    `[json-store] PostgreSQL unavailable, falling back to local JSON storage. ${error?.message || "Unknown database error."}`
  );
}

function isLocalDatabaseHost(hostname = "") {
  const value = cleanText(hostname).toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function isPrivateIpv4Host(hostname = "") {
  const match = cleanText(hostname).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const parts = match.slice(1).map((value) => Number.parseInt(value, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  if (first === 10 || first === 127) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }

  return false;
}

function isPrivateDatabaseHost(hostname = "") {
  const value = cleanText(hostname).toLowerCase();
  if (!value) {
    return false;
  }

  return (
    isLocalDatabaseHost(value) ||
    isPrivateIpv4Host(value) ||
    value.endsWith(".railway.internal") ||
    value.endsWith(".internal") ||
    value.endsWith(".local") ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:")
  );
}

function parseDatabaseUrl() {
  try {
    return new URL(config.databaseUrl);
  } catch {
    return null;
  }
}

function buildSslOption(enabled) {
  return enabled ? { rejectUnauthorized: false } : false;
}

function sslSignature(sslOption) {
  return sslOption ? "tls" : "plain";
}

function describeSslOption(sslOption) {
  return sslOption ? "SSL" : "non-SSL";
}

function getExplicitSslOption() {
  const mode = cleanText(config.databaseSsl).toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "off") {
    return buildSslOption(false);
  }
  if (mode === "require" || mode === "true" || mode === "on") {
    return buildSslOption(true);
  }

  const url = parseDatabaseUrl();
  const urlMode = cleanText(url?.searchParams.get("sslmode")).toLowerCase();
  if (urlMode === "disable" || urlMode === "allow") {
    return buildSslOption(false);
  }
  if (
    urlMode === "prefer" ||
    urlMode === "require" ||
    urlMode === "verify-ca" ||
    urlMode === "verify-full"
  ) {
    return buildSslOption(true);
  }

  return null;
}

function resolveSslVariants() {
  if (typeof activeSslOption !== "undefined") {
    return [activeSslOption];
  }

  const explicit = getExplicitSslOption();
  if (explicit !== null) {
    return [explicit];
  }

  const url = parseDatabaseUrl();
  const preferSsl = url ? !isPrivateDatabaseHost(url.hostname) : false;
  const variants = [buildSslOption(preferSsl), buildSslOption(!preferSsl)];
  return variants.filter(
    (sslOption, index, list) => index === 0 || sslSignature(sslOption) !== sslSignature(list[0])
  );
}

async function resetPool() {
  const current = pool;
  pool = null;
  poolSignature = "";
  if (current) {
    await current.end().catch(() => {});
  }
}

function getPool(sslOption) {
  if (!isDatabaseConfigured() || databaseDisabled) {
    return null;
  }

  const resolvedSslOption =
    typeof sslOption === "undefined"
      ? (typeof activeSslOption === "undefined" ? resolveSslVariants()[0] : activeSslOption)
      : sslOption;
  const signature = sslSignature(resolvedSslOption);

  if (!pool || poolSignature !== signature) {
    void resetPool();
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: resolvedSslOption,
      max: 10,
      connectionTimeoutMillis: config.databaseConnectTimeoutMs,
      idleTimeoutMillis: 30000
    });
    poolSignature = signature;
    pool.on("error", (error) => {
      console.warn(`[json-store] PostgreSQL pool error: ${error.message}`);
    });
  }

  return pool;
}

async function connectDatabaseClient() {
  const variants = resolveSslVariants();
  let lastError = null;

  for (let index = 0; index < variants.length; index += 1) {
    const sslOption = variants[index];

    try {
      const client = await getPool(sslOption).connect();
      activeSslOption = sslOption;
      return client;
    } catch (error) {
      lastError = error;
      await resetPool();

      if (index < variants.length - 1) {
        const nextSslOption = variants[index + 1];
        console.warn(
          `[json-store] PostgreSQL connection failed with ${describeSslOption(sslOption)}; retrying with ${describeSslOption(nextSslOption)}. ${error.message}`
        );
      }
    }
  }

  throw lastError;
}

async function ensureDatabaseReady() {
  if (!hasDatabaseStorage()) {
    return false;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const client = await connectDatabaseClient();
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
    })().catch((error) => {
      disableDatabaseStorage(error);
      initPromise = null;
      return false;
    });
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
  const ready = await ensureDatabaseReady();
  if (!ready) {
    return readLocalJson(fileNames, defaults, name);
  }
  await seedDatabaseRow(namespace, name, defaults[name], fileNames, defaults);

  const result = await getPool().query(
    `SELECT data FROM app_json_store WHERE namespace = $1 AND name = $2`,
    [namespace, name]
  );

  return result.rows[0]?.data ?? cloneValue(defaults[name]);
}

async function writeDatabaseJson(namespace, fileNames, defaults, name, data) {
  const ready = await ensureDatabaseReady();
  if (!ready) {
    return writeLocalJson(fileNames, defaults, name, data);
  }
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
  const ready = await ensureDatabaseReady();
  if (!ready) {
    return withLocalWriteLock(namespace, fileNames, defaults, name, updater);
  }
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
        const ready = await ensureDatabaseReady();
        if (ready) {
          await Promise.all(
            Object.keys(fileNames).map((name) =>
              seedDatabaseRow(namespace, name, clonedDefaults[name], fileNames, clonedDefaults)
            )
          );
          return;
        }
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
        ? writeDatabaseJson(namespace, fileNames, clonedDefaults, name, data)
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
