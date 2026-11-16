import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { normalizePlatformAvatarId, PLATFORM_AVATARS_UPDATED_EVENT } from "./platform-avatar-storage";

const NICKNAMES_STORAGE_KEY = "ai_phone_character_platform_nicknames_v1";
registerKvMigration(NICKNAMES_STORAGE_KEY);

function cleanCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

/** Load all non-empty platform nicknames saved for one character. */
export function loadCharacterPlatformNicknames(characterId: string): Record<string, string> {
  const id = cleanCharacterId(characterId);
  if (!id || typeof window === "undefined") return {};
  try {
    const raw = kvGet(NICKNAMES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = (parsed as Record<string, unknown>)[id];
    if (!record || typeof record !== "object" || Array.isArray(record)) return {};

    const result: Record<string, string> = {};
    for (const [rawPlatformId, rawNickname] of Object.entries(record as Record<string, unknown>)) {
      const platformId = normalizePlatformAvatarId(rawPlatformId);
      const nickname = typeof rawNickname === "string" ? rawNickname.trim().slice(0, 48) : "";
      if (platformId && nickname) result[platformId] = nickname;
    }
    return result;
  } catch {
    return {};
  }
}

/** Save platform nicknames independently of the character's main name. */
export function saveCharacterPlatformNicknames(
  characterId: string,
  selections: Record<string, string>,
): void {
  const id = cleanCharacterId(characterId);
  if (!id) throw new Error("保存平台昵称需要有效的人物档案 ID。");

  let all: Record<string, Record<string, string>> = {};
  try {
    const raw = kvGet(NICKNAMES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      all = parsed as Record<string, Record<string, string>>;
    }
  } catch {
    all = {};
  }

  const next: Record<string, string> = {};
  for (const [rawPlatformId, rawNickname] of Object.entries(selections)) {
    const platformId = normalizePlatformAvatarId(rawPlatformId);
    const nickname = typeof rawNickname === "string" ? rawNickname.trim().slice(0, 48) : "";
    if (platformId && nickname) next[platformId] = nickname;
  }

  if (Object.keys(next).length) all[id] = next;
  else delete all[id];
  kvSet(NICKNAMES_STORAGE_KEY, JSON.stringify(all));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PLATFORM_AVATARS_UPDATED_EVENT, { detail: { characterId: id } }));
  }
}
