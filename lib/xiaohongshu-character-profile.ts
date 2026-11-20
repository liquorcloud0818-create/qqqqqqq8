import type { Character } from "./character-types";
import type { CheckPhoneXiaohongshuPayload } from "./checkphone-config";
import { readPhoneSnapshotCache } from "./checkphone-storage";
import { loadCharacterPlatformNicknames } from "./character-platform-profile-storage";

/** Resolve the character's XHS display name without mutating their main character name. */
export function resolveCharacterXiaohongshuDisplayName(
  character: Pick<Character, "id" | "name">,
): string {
  const platformNickname = loadCharacterPlatformNicknames(character.id).xiaohongshu?.trim();
  if (platformNickname) return platformNickname;

  // Keep existing CheckPhone snapshots as a legacy fallback for older profiles.
  const snapshot = readPhoneSnapshotCache<CheckPhoneXiaohongshuPayload>(character.id, "xiaohongshu");
  const legacyProfileName = snapshot?.payload?.profile?.name?.trim();
  return legacyProfileName || character.name;
}
