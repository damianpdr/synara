// FILE: credentials.ts
// Purpose: Persist the paired server + bearer session in the iOS keychain.
// Layer: Mobile state
// Exports: loadCredentials, saveCredentials, clearCredentials, SynaraCredentials.
//
// expo-secure-store is backed by the iOS keychain and works inside Expo Go, so
// no custom native module is needed. The bearer session token is a 30-day
// credential and must never land in AsyncStorage or plain files.

import * as SecureStore from "expo-secure-store";

const BASE_URL_KEY = "synara.baseUrl";
const SESSION_TOKEN_KEY = "synara.sessionToken";

export interface SynaraCredentials {
  readonly baseUrl: string;
  readonly sessionToken: string;
}

export async function loadCredentials(): Promise<SynaraCredentials | null> {
  const [baseUrl, sessionToken] = await Promise.all([
    SecureStore.getItemAsync(BASE_URL_KEY),
    SecureStore.getItemAsync(SESSION_TOKEN_KEY),
  ]);
  if (!baseUrl || !sessionToken) return null;
  return { baseUrl, sessionToken };
}

export async function saveCredentials(credentials: SynaraCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(BASE_URL_KEY, credentials.baseUrl),
    SecureStore.setItemAsync(SESSION_TOKEN_KEY, credentials.sessionToken),
  ]);
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(BASE_URL_KEY),
    SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
  ]);
}
