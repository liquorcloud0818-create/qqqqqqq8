import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "./chat-asset-storage";

const STORAGE_KEY = "ai_phone_character_platform_avatars_v1";
export const PLATFORM_AVATARS_UPDATED_EVENT = "character-platform-avatars-updated";
const STORAGE_VERSION = 1 as const;
const MAX_PLATFORM_AVATAR_BYTES = 15 * 1024 * 1024;

registerKvMigration(STORAGE_KEY);

type PlatformAvatarRecord = {
  assetId: string;
  updatedAt: number;
};

type PlatformAvatarStore = {
  version: typeof STORAGE_VERSION;
  characters: Record<string, Record<string, PlatformAvatarRecord>>;
};

const EMPTY_STORE: PlatformAvatarStore = {
  version: STORAGE_VERSION,
  characters: {},
};

function cleanCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

/** Built-in platform IDs and namespaced custom app IDs share the same format. */
export function normalizePlatformAvatarId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

function loadStore(): PlatformAvatarStore {
  if (typeof window === "undefined") return { version: STORAGE_VERSION, characters: {} };
  try {
    const raw = kvGet(STORAGE_KEY);
    if (!raw) return { version: STORAGE_VERSION, characters: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: STORAGE_VERSION, characters: {} };
    }
    const source = parsed as Record<string, unknown>;
    const rawCharacters = source.characters;
    if (!rawCharacters || typeof rawCharacters !== "object" || Array.isArray(rawCharacters)) {
      return { version: STORAGE_VERSION, characters: {} };
    }

    const characters: PlatformAvatarStore["characters"] = {};
    for (const [rawCharacterId, rawPlatforms] of Object.entries(rawCharacters as Record<string, unknown>)) {
      const characterId = cleanCharacterId(rawCharacterId);
      if (!characterId || !rawPlatforms || typeof rawPlatforms !== "object" || Array.isArray(rawPlatforms)) continue;
      const platforms: Record<string, PlatformAvatarRecord> = {};
      for (const [rawPlatformId, rawRecord] of Object.entries(rawPlatforms as Record<string, unknown>)) {
        const platformId = normalizePlatformAvatarId(rawPlatformId);
        if (!platformId || !rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) continue;
        const record = rawRecord as Record<string, unknown>;
        if (typeof record.assetId !== "string" || !record.assetId.trim()) continue;
        platforms[platformId] = {
          assetId: record.assetId.trim().slice(0, 180),
          updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
            ? record.updatedAt
            : Date.now(),
        };
      }
      if (Object.keys(platforms).length) characters[characterId] = platforms;
    }
    return { version: STORAGE_VERSION, characters };
  } catch {
    return { version: STORAGE_VERSION, characters: {} };
  }
}

function persist(store: PlatformAvatarStore, characterId: string): void {
  if (typeof window === "undefined") return;
  kvSet(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(PLATFORM_AVATARS_UPDATED_EVENT, {
    detail: { characterId },
  }));
}

/**
 * Save a picture selected by the user into the phone's existing IndexedDB asset store.
 * This only creates an asset; it does not assign the picture to a character or platform.
 */
export async function savePlatformAvatarAsset(file: File): Promise<string> {
  if (!(file instanceof Blob) || !file.size) throw new Error("请选择有效的图片文件。");
  if (!file.type.toLowerCase().startsWith("image/")) throw new Error("头像必须是图片文件。");
  if (file.size > MAX_PLATFORM_AVATAR_BYTES) throw new Error("单张平台头像不能超过 15 MB。");

  const assetId = await saveChatImageToIndexedDB(file);
  const saved = await getChatImageFromIndexedDB(assetId).catch(() => null);
  if (!saved) throw new Error("图片保存失败，请重新选择。");
  return assetId;
}

/** Return platformId -> IndexedDB assetId for one character. */
export function loadCharacterPlatformAvatars(characterId: string): Record<string, string> {
  const id = cleanCharacterId(characterId);
  if (!id) return {};
  const platforms = loadStore().characters[id] || {};
  return Object.fromEntries(Object.entries(platforms).map(([platformId, record]) => [platformId, record.assetId]));
}

/** Resolve an IndexedDB asset ID to a displayable data URL for previews and app adapters. */
export async function resolvePlatformAvatarAsset(assetId: string): Promise<string | null> {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!id) return null;
  return getChatImageFromIndexedDB(id).catch(() => null);
}

/**
 * Commit the avatar selections staged in the character dossier.
 * Empty values mean "no custom platform avatar"; the character's main avatar is untouched.
 */
export function saveCharacterPlatformAvatars(
  characterId: string,
  selections: Record<string, string>,
): void {
  const id = cleanCharacterId(characterId);
  if (!id) throw new Error("保存平台头像需要有效的人物档案 ID。");

  const store = loadStore();
  const next: Record<string, PlatformAvatarRecord> = {};
  for (const [rawPlatformId, rawAssetId] of Object.entries(selections)) {
    const platformId = normalizePlatformAvatarId(rawPlatformId);
    const assetId = typeof rawAssetId === "string" ? rawAssetId.trim().slice(0, 180) : "";
    if (!platformId || !assetId) continue;
    next[platformId] = { assetId, updatedAt: Date.now() };
  }

  if (Object.keys(next).length) store.characters[id] = next;
  else delete store.characters[id];
  persist(store, id);
}

export function removeCharacterPlatformAvatar(characterId: string, platformId: string): void {
  const id = cleanCharacterId(characterId);
  const platform = normalizePlatformAvatarId(platformId);
  if (!id || !platform) return;

  const store = loadStore();
  const current = store.characters[id];
  if (!current || !(platform in current)) return;
  const next = { ...current };
  delete next[platform];
  if (Object.keys(next).length) store.characters[id] = next;
  else delete store.characters[id];
  persist(store, id);
}
