import { SessionState, sessionStateSchema } from "./session-schema";

export const SESSION_STORAGE_KEY = "siteward.session";

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

export interface SessionStore {
  read(): Promise<SessionState | undefined>;
  write(input: unknown): Promise<void>;
}

export async function createSessionStore(
  area: SessionStorageArea = chrome.storage.session,
): Promise<SessionStore> {
  await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

  return {
    async read() {
      const items = await area.get(SESSION_STORAGE_KEY);

      const parsed = sessionStateSchema.safeParse(items[SESSION_STORAGE_KEY]);

      return parsed.success ? parsed.data : undefined;
    },

    async write(input: unknown) {
      const state = sessionStateSchema.parse(input);

      await area.set({
        [SESSION_STORAGE_KEY]: state,
      });
    },
  };
}
