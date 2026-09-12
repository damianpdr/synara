// FILE: credentials.ts
// Purpose: Persist paired Synara servers + bearer sessions in the iOS keychain.
// Layer: Mobile state
// Exports: SynaraCredentials, SavedConnection, loadCredentials, saveCredentials,
//          clearCredentials, listConnections, setActiveConnection, removeConnection.
//
// expo-secure-store is backed by the iOS keychain and works inside Expo Go, so
// no custom native module is needed. The bearer session token is a 30-day
// credential and must never land in AsyncStorage or a plain file.
//
// v1 only ever has ONE active connection, but the on-disk shape is already a
// list + an active id so adding a connection switcher later is a UI change
// rather than a migration. Everything is kept in a single keychain item: each
// `SecureStore` value is capped (~2 KB on iOS) and a session token is ~250
// bytes, which leaves room for a handful of servers.

import * as SecureStore from "expo-secure-store";

const CONNECTIONS_KEY = "synara.connections";

/** Pre-list keys, read once and deleted. Do not reuse these names. */
const LEGACY_BASE_URL_KEY = "synara.baseUrl";
const LEGACY_SESSION_TOKEN_KEY = "synara.sessionToken";

export interface SynaraCredentials {
  readonly baseUrl: string;
  readonly sessionToken: string;
  /** Server-reported role from the pairing exchange ("owner", ...). */
  readonly role?: string | undefined;
}

export interface SavedConnection extends SynaraCredentials {
  readonly id: string;
  readonly pairedAt: string;
}

interface ConnectionsFile {
  readonly version: 1;
  readonly activeId: string | null;
  readonly connections: readonly SavedConnection[];
}

const EMPTY_FILE: ConnectionsFile = { version: 1, activeId: null, connections: [] };

function isConnection(value: unknown): value is SavedConnection {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["baseUrl"] === "string" &&
    typeof record["sessionToken"] === "string"
  );
}

function parseFile(raw: string | null): ConnectionsFile | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const connections = Array.isArray(record["connections"])
      ? record["connections"].filter(isConnection)
      : [];
    const activeId = typeof record["activeId"] === "string" ? record["activeId"] : null;
    return { version: 1, activeId, connections };
  } catch {
    // A corrupt keychain item must not brick the app: fall through to "no
    // saved connection", which lands the user on the pairing screen.
    return null;
  }
}

async function writeFile(file: ConnectionsFile): Promise<void> {
  await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify(file));
}

/**
 * Moves the pre-list keys into the list shape and deletes them, so an app that
 * was already paired does not have to re-pair after this upgrade.
 */
async function migrateLegacy(): Promise<ConnectionsFile | null> {
  const [baseUrl, sessionToken] = await Promise.all([
    SecureStore.getItemAsync(LEGACY_BASE_URL_KEY),
    SecureStore.getItemAsync(LEGACY_SESSION_TOKEN_KEY),
  ]);
  if (!baseUrl || !sessionToken) return null;
  const connection: SavedConnection = {
    id: makeConnectionId(baseUrl),
    baseUrl,
    sessionToken,
    pairedAt: new Date().toISOString(),
  };
  const file: ConnectionsFile = { version: 1, activeId: connection.id, connections: [connection] };
  await writeFile(file);
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_BASE_URL_KEY),
    SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY),
  ]);
  return file;
}

async function readFile(): Promise<ConnectionsFile> {
  const parsed = parseFile(await SecureStore.getItemAsync(CONNECTIONS_KEY));
  if (parsed) return parsed;
  return (await migrateLegacy()) ?? EMPTY_FILE;
}

/** Origin-derived, so re-pairing the same server replaces its entry. */
function makeConnectionId(baseUrl: string): string {
  return baseUrl.toLowerCase();
}

function activeOf(file: ConnectionsFile): SavedConnection | null {
  return file.connections.find((entry) => entry.id === file.activeId) ?? null;
}

/** The active connection, or null when nothing is paired. */
export async function loadCredentials(): Promise<SavedConnection | null> {
  return activeOf(await readFile());
}

export async function listConnections(): Promise<readonly SavedConnection[]> {
  return (await readFile()).connections;
}

/** Upserts a connection by origin and makes it active. */
export async function saveCredentials(credentials: SynaraCredentials): Promise<SavedConnection> {
  const file = await readFile();
  const id = makeConnectionId(credentials.baseUrl);
  const previous = file.connections.find((entry) => entry.id === id);
  const connection: SavedConnection = {
    id,
    baseUrl: credentials.baseUrl,
    sessionToken: credentials.sessionToken,
    pairedAt: new Date().toISOString(),
    ...(credentials.role === undefined
      ? previous?.role === undefined
        ? {}
        : { role: previous.role }
      : { role: credentials.role }),
  };
  await writeFile({
    version: 1,
    activeId: id,
    connections: [...file.connections.filter((entry) => entry.id !== id), connection],
  });
  return connection;
}

export async function setActiveConnection(id: string): Promise<SavedConnection | null> {
  const file = await readFile();
  if (!file.connections.some((entry) => entry.id === id)) return null;
  await writeFile({ ...file, activeId: id });
  return activeOf({ ...file, activeId: id });
}

export async function removeConnection(id: string): Promise<void> {
  const file = await readFile();
  const connections = file.connections.filter((entry) => entry.id !== id);
  const activeId = file.activeId === id ? (connections[0]?.id ?? null) : file.activeId;
  await writeFile({ version: 1, activeId, connections });
}

/** Forgets every paired server. Used by "Disconnect" in settings. */
export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CONNECTIONS_KEY),
    SecureStore.deleteItemAsync(LEGACY_BASE_URL_KEY),
    SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY),
  ]);
}
