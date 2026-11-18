import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { normalizePlatformAvatarId } from "./platform-avatar-storage";

const STORAGE_KEY = "ai_phone_user_identity_platform_profiles_v1";
const STORAGE_VERSION = 1 as const;

/** Five built-in social identities. Custom apps and Lianhua are intentionally excluded. */
export const USER_PLATFORM_IDS = [
  "chat",
  "twitter",
  "weibo",
  "douyin",
  "xiaohongshu",
] as const;

export type UserPlatformId = (typeof USER_PLATFORM_IDS)[number];

export type UserIdentityPlatformProfile = {
  nickname: string;
  /** IndexedDB asset ID; resolve it with resolvePlatformAvatarAsset before rendering. */
  avatarAssetId: string;
  updatedAt: number;
};

type UserPlatformProfileStore = {
  version: typeof STORAGE_VERSION;
  identities: Record<string, Record<string, UserIdentityPlatformProfile>>;
};

export const USER_PLATFORM_PROFILES_UPDATED_EVENT = "user-identity-platform-profiles-updated";

const ALLOWED_PLATFORM_IDS = new Set<string>(USER_PLATFORM_IDS);

registerKvMigration(STORAGE_KEY);

function cleanIdentityId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function loadStore(): UserPlatformProfileStore {
  if (typeof window === "undefined") {
    return { version: STORAGE_VERSION, identities: {} };
  }

  try {
    const raw = kvGet(STORAGE_KEY);
    if (!raw) return { version: STORAGE_VERSION, identities: {} };

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: STORAGE_VERSION, identities: {} };
    }

    const source = parsed as Record<string, unknown>;
    const rawIdentities = source.identities;
    if (!rawIdentities || typeof rawIdentities !== "object" || Array.isArray(rawIdentities)) {
      return { version: STORAGE_VERSION, identities: {} };
    }

    const identities: UserPlatformProfileStore["identities"] = {};
    for (const [rawIdentityId, rawProfiles] of Object.entries(rawIdentities as Record<string, unknown>)) {
      const identityId = cleanIdentityId(rawIdentityId);
      if (!identityId || !rawProfiles || typeof rawProfiles !== "object" || Array.isArray(rawProfiles)) continue;

      const profiles: Record<string, UserIdentityPlatformProfile> = {};
      for (const [rawPlatformId, rawProfile] of Object.entries(rawProfiles as Record<string, unknown>)) {
        const platformId = normalizePlatformAvatarId(rawPlatformId);
        if (!ALLOWED_PLATFORM_IDS.has(platformId) || !rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) continue;

        const record = rawProfile as Record<string, unknown>;
        const nickname = cleanText(record.nickname, 48);
        const avatarAssetId = cleanText(record.avatarAssetId, 180);
        if (!nickname && !avatarAssetId) continue;

        profiles[platformId] = {
          nickname,
          avatarAssetId,
          updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
            ? record.updatedAt
            : 0,
        };
      }

      if (Object.keys(profiles).length) identities[identityId] = profiles;
    }

    return { version: STORAGE_VERSION, identities };
  } catch {
    return { version: STORAGE_VERSION, identities: {} };
  }
}

function persistIdentityProfiles(
  identityId: string,
  profiles: Record<string, UserIdentityPlatformProfile>,
): void {
  if (typeof window === "undefined") return;
  const store = loadStore();
  const next: Record<string, UserIdentityPlatformProfile> = {};

  for (const platformId of USER_PLATFORM_IDS) {
    const profile = profiles[platformId];
    if (!profile) continue;
    const nickname = cleanText(profile.nickname, 48);
    const avatarAssetId = cleanText(profile.avatarAssetId, 180);
    if (!nickname && !avatarAssetId) continue;
    next[platformId] = {
      nickname,
      avatarAssetId,
      updatedAt: Date.now(),
    };
  }

  if (Object.keys(next).length) store.identities[identityId] = next;
  else delete store.identities[identityId];

  kvSet(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(USER_PLATFORM_PROFILES_UPDATED_EVENT, {
    detail: { identityId },
  }));
}

/** Load the five platform profiles for one User identity card. */
export function loadUserIdentityPlatformProfiles(
  identityId: string,
): Record<string, UserIdentityPlatformProfile> {
  const id = cleanIdentityId(identityId);
  if (!id) return {};
  return { ...(loadStore().identities[id] || {}) };
}

/** Load platformId -> IndexedDB avatar asset ID for one User identity card. */
export function loadUserIdentityPlatformAvatars(identityId: string): Record<string, string> {
  const profiles = loadUserIdentityPlatformProfiles(identityId);
  return Object.fromEntries(
    Object.entries(profiles)
      .filter(([, profile]) => Boolean(profile.avatarAssetId))
      .map(([platformId, profile]) => [platformId, profile.avatarAssetId]),
  );
}

/** Load platformId -> nickname for one User identity card. */
export function loadUserIdentityPlatformNicknames(identityId: string): Record<string, string> {
  const profiles = loadUserIdentityPlatformProfiles(identityId);
  return Object.fromEntries(
    Object.entries(profiles)
      .filter(([, profile]) => Boolean(profile.nickname))
      .map(([platformId, profile]) => [platformId, profile.nickname]),
  );
}

/** Save all five avatar selections while retaining each platform nickname. */
export function saveUserIdentityPlatformAvatars(
  identityId: string,
  selections: Record<string, string>,
): void {
  const id = cleanIdentityId(identityId);
  if (!id) throw new Error("保存 User 平台头像需要有效的身份卡 ID。");

  const current = loadUserIdentityPlatformProfiles(id);
  const next = { ...current };
  for (const platformId of USER_PLATFORM_IDS) {
    next[platformId] = {
      nickname: current[platformId]?.nickname || "",
      avatarAssetId: cleanText(selections[platformId], 180),
      updatedAt: Date.now(),
    };
  }
  persistIdentityProfiles(id, next);
}

/** Save all five nicknames while retaining each platform avatar. */
export function saveUserIdentityPlatformNicknames(
  identityId: string,
  selections: Record<string, string>,
): void {
  const id = cleanIdentityId(identityId);
  if (!id) throw new Error("保存 User 平台昵称需要有效的身份卡 ID。");

  const current = loadUserIdentityPlatformProfiles(id);
  const next = { ...current };
  for (const platformId of USER_PLATFORM_IDS) {
    next[platformId] = {
      nickname: cleanText(selections[platformId], 48),
      avatarAssetId: current[platformId]?.avatarAssetId || "",
      updatedAt: Date.now(),
    };
  }
  persistIdentityProfiles(id, next);
}

/** Save nickname and avatar selections together for one User identity card. */
export function saveUserIdentityPlatformProfiles(
  identityId: string,
  selections: Record<string, { nickname?: string; avatarAssetId?: string }>,
): void {
  const id = cleanIdentityId(identityId);
  if (!id) throw new Error("保存 User 平台资料需要有效的身份卡 ID。");

  const next: Record<string, UserIdentityPlatformProfile> = {};
  for (const platformId of USER_PLATFORM_IDS) {
    const selection = selections[platformId];
    next[platformId] = {
      nickname: cleanText(selection?.nickname, 48),
      avatarAssetId: cleanText(selection?.avatarAssetId, 180),
      updatedAt: Date.now(),
    };
  }
  persistIdentityProfiles(id, next);
}
