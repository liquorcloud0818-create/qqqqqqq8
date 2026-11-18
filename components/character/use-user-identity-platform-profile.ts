"use client";

import { useEffect, useState } from "react";
import {
  normalizePlatformAvatarId,
  resolvePlatformAvatarAsset,
} from "@/lib/platform-avatar-storage";
import {
  loadUserIdentityPlatformProfiles,
  USER_PLATFORM_IDS,
  USER_PLATFORM_PROFILES_UPDATED_EVENT,
  type UserPlatformId,
} from "@/lib/user-platform-profile-storage";

export type UserIdentityPlatformProfileView = {
  nickname: string;
  avatarUrl: string | null;
};

const EMPTY_PROFILE: UserIdentityPlatformProfileView = {
  nickname: "",
  avatarUrl: null,
};

/**
 * Read one User identity card's nickname and avatar for a single built-in app.
 * The hook deliberately does not resolve a User identity binding by itself:
 * callers pass the already-resolved identity card ID for their app/account.
 */
export function useUserIdentityPlatformProfile(
  identityId: string | null | undefined,
  platformId: UserPlatformId | string,
): UserIdentityPlatformProfileView {
  const normalizedPlatformId = normalizePlatformAvatarId(platformId);
  const safeIdentityId = typeof identityId === "string" ? identityId.trim() : "";
  const isSupportedPlatform = USER_PLATFORM_IDS.includes(normalizedPlatformId as UserPlatformId);
  const profileKey = `${safeIdentityId}::${normalizedPlatformId}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    profile: UserIdentityPlatformProfileView;
  }>({ key: "", profile: EMPTY_PROFILE });

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const refresh = async () => {
      const currentRequestId = ++requestId;
      if (!safeIdentityId || !isSupportedPlatform) {
        if (active) setSnapshot({ key: profileKey, profile: EMPTY_PROFILE });
        return;
      }

      const saved = loadUserIdentityPlatformProfiles(safeIdentityId)[normalizedPlatformId];
      const avatarUrl = saved?.avatarAssetId
        ? await resolvePlatformAvatarAsset(saved.avatarAssetId)
        : null;

      if (!active || currentRequestId !== requestId) return;
      setSnapshot({
        key: profileKey,
        profile: {
          nickname: saved?.nickname || "",
          avatarUrl,
        },
      });
    };

    const handleProfileUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ identityId?: string }>).detail;
      if (!detail?.identityId || detail.identityId === safeIdentityId) {
        void refresh();
      }
    };

    void refresh();
    window.addEventListener(USER_PLATFORM_PROFILES_UPDATED_EVENT, handleProfileUpdate);

    return () => {
      active = false;
      window.removeEventListener(USER_PLATFORM_PROFILES_UPDATED_EVENT, handleProfileUpdate);
    };
  }, [safeIdentityId, normalizedPlatformId, isSupportedPlatform, profileKey]);

  // Never expose the previous identity card's profile during an identity switch.
  return snapshot.key === profileKey ? snapshot.profile : EMPTY_PROFILE;
}
