"use client";

import { useEffect, useState } from "react";
import {
  loadCharacterPlatformAvatars,
  normalizePlatformAvatarId,
  PLATFORM_AVATARS_UPDATED_EVENT,
  resolvePlatformAvatarAsset,
} from "@/lib/platform-avatar-storage";
import { loadCharacterPlatformNicknames } from "@/lib/character-platform-profile-storage";

export type CharacterPlatformProfile = {
  nickname: string;
  avatarUrl: string | null;
};

const EMPTY_PROFILE: CharacterPlatformProfile = {
  nickname: "",
  avatarUrl: null,
};

/** Read one character's saved identity for a single in-phone platform. */
export function useCharacterPlatformProfile(
  characterId: string,
  platformId: string,
): CharacterPlatformProfile {
  const [profile, setProfile] = useState<CharacterPlatformProfile>(EMPTY_PROFILE);
  const normalizedPlatformId = normalizePlatformAvatarId(platformId);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const refresh = async () => {
      const currentRequestId = ++requestId;
      const nicknames = loadCharacterPlatformNicknames(characterId);
      const avatars = loadCharacterPlatformAvatars(characterId);
      const assetId = avatars[normalizedPlatformId];
      const avatarUrl = assetId ? await resolvePlatformAvatarAsset(assetId) : null;

      if (!active || currentRequestId !== requestId) return;
      setProfile({
        nickname: nicknames[normalizedPlatformId] || "",
        avatarUrl,
      });
    };

    const handleProfileUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ characterId?: string }>).detail;
      if (!detail?.characterId || detail.characterId === characterId) {
        void refresh();
      }
    };

    void refresh();
    window.addEventListener(PLATFORM_AVATARS_UPDATED_EVENT, handleProfileUpdate);

    return () => {
      active = false;
      window.removeEventListener(PLATFORM_AVATARS_UPDATED_EVENT, handleProfileUpdate);
    };
  }, [characterId, normalizedPlatformId]);

  return profile;
}
