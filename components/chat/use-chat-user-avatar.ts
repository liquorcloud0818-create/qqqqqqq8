"use client";

import { chatContactDisplayName } from "@/lib/communication-display-name";
import { useEffect, useState } from "react";
import {
    loadChatAppSettings,
    CHAT_APP_SETTINGS_UPDATED_EVENT,
    resolveChatUserAvatar,
    type ChatSession,
} from "@/lib/chat-storage";
import { resolveUserIdentity, USER_IDENTITIES_UPDATED_EVENT } from "@/lib/settings-storage";
import {
    resolveChatCharacterAvatar,
    resolveChatCharacterDisplayName,
    CHAT_CHARACTER_PROFILES_UPDATED_EVENT,
} from "@/lib/chat-profile-storage";
import type { Character } from "@/lib/character-types";
import { useUserIdentityPlatformProfile } from "@/components/character/use-user-identity-platform-profile";

export function useChatUserAvatar(session?: ChatSession) {
    // Re-resolve the currently bound User identity whenever its binding or identity
    // data changes. The platform-profile hook independently subscribes to profile
    // updates and guards against showing a previous identity's avatar.
    const [, forceRefresh] = useState(0);

    useEffect(() => {
        const sync = () => forceRefresh(value => value + 1);
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
        window.addEventListener(USER_IDENTITIES_UPDATED_EVENT, sync);
        window.addEventListener("settings-bindings-updated", sync);
        return () => {
            window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
            window.removeEventListener(USER_IDENTITIES_UPDATED_EVENT, sync);
            window.removeEventListener("settings-bindings-updated", sync);
        };
    }, [session?.contactId, session?.userAvatarOverride, session?.isGroup]);

    const identity = session
        ? resolveUserIdentity(
            session.isGroup ? undefined : session.contactId,
            session.isGroup ? "group_chat" : "chat",
        )
        : resolveUserIdentity();

    const chatPlatformProfile = useUserIdentityPlatformProfile(identity?.id, "chat");

    // Preserve the explicit per-session avatar override. Otherwise the dedicated
    // Chat/朋友圈 identity wins over legacy global Chat and base identity avatars.
    return (
        session?.userAvatarOverride
        || chatPlatformProfile.avatarUrl
        || resolveChatUserAvatar(undefined, identity?.avatarUrl)
    );
}

export function useChatCallIdentity(character: Character, session: ChatSession) {
    const read = () => ({
        avatar: resolveChatCharacterAvatar(character) || "",
        name: chatContactDisplayName(character.id, session),
    });
    const [identity, setIdentity] = useState(read);
    useEffect(() => {
        const sync = () => setIdentity(read());
        sync();
        window.addEventListener(CHAT_CHARACTER_PROFILES_UPDATED_EVENT, sync);
        return () => window.removeEventListener(CHAT_CHARACTER_PROFILES_UPDATED_EVENT, sync);
    }, [character, session.alias]);
    return identity;
}

export function useGlobalCallAppearance() {
    const [value, setValue] = useState(() => loadChatAppSettings().globalUserCallAppearance || "");
    useEffect(() => {
        const sync = () => setValue(loadChatAppSettings().globalUserCallAppearance || "");
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
        return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, sync);
    }, []);
    return value;
}
