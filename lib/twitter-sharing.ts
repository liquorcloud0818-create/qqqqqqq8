import { createOrGetSession, pushChatMessage } from "./chat-storage";
import { activeReverse } from "./reverse-phone-state";
import { CHAT_OPEN_SESSION_EVENT } from "./chat-notification-events";
import { resolveUserIdentity } from "./settings-storage";
import { loadUserIdentityPlatformProfiles } from "./user-platform-profile-storage";
import { resolvePlatformAvatarAsset } from "./platform-avatar-storage";
import {
  loadTwitterState,
  snapshotTwitterPost,
  twitterSnapshotText,
  twitterRecognizes,
  type TwitterSnapshot,
} from "./twitter-storage";

/**
 * Share an X post into a character's Chat session.
 * The User main account's X profile is resolved from the selected User identity.
 * This only changes the newly-created snapshot; stored posts and old snapshots
 * remain untouched. User alternate accounts and character accounts stay separate.
 */
export function shareTwitterToChat(
  postId: string,
  characterId: string,
  userMainProfile?: { name?: string; avatarUrl?: string },
): void {
  if (activeReverse()) throw new Error("反查期间不能分享");

  const state = loadTwitterState();
  const snapshot = snapshotTwitterPost(state, postId);
  const session = createOrGetSession(characterId);
  if (!session) throw new Error("无法找到会话");

  const identity = resolveUserIdentity(undefined, "twitter");
  const savedPlatformProfile = identity
    ? loadUserIdentityPlatformProfiles(identity.id).twitter
    : undefined;

  const resolveUserAvatar = async (): Promise<string | undefined> => {
    if (userMainProfile?.avatarUrl) return userMainProfile.avatarUrl;
    if (savedPlatformProfile?.avatarAssetId) {
      const resolved = await resolvePlatformAvatarAsset(
        savedPlatformProfile.avatarAssetId,
      );
      if (resolved) return resolved;
    }
    return state.profile.avatarUrl || identity?.avatarUrl || undefined;
  };

  void (async () => {
    const userName =
      userMainProfile?.name?.trim() ||
      savedPlatformProfile?.nickname?.trim() ||
      state.profile.name ||
      identity?.name ||
      "我";
    const userAvatar = await resolveUserAvatar();

    const applyUserDisplay = (entry: TwitterSnapshot): TwitterSnapshot => {
      if (entry.authorId !== "user") return entry;
      return {
        ...entry,
        name: userName,
        avatar: userAvatar || entry.avatar,
      };
    };

    const displaySnapshot: TwitterSnapshot = {
      ...applyUserDisplay(snapshot),
      comments: snapshot.comments?.map(applyUserDisplay),
    };
    const text =
      twitterSnapshotText(displaySnapshot) +
      "；作者真实身份是否已知：" +
      twitterRecognizes(state, displaySnapshot.authorId, characterId);

    pushChatMessage({
      sessionId: session.id,
      role: "user",
      content: text,
      mediaType: "app_card",
      mediaData: {
        appId: "twitter",
        appName: "X",
        appCardTitle: displaySnapshot.name + " 的帖子",
        appCardBody: displaySnapshot.translated || displaySnapshot.original,
        appHistoryText: text,
        twitterPostSnapshot: displaySnapshot,
      },
    });

    window.dispatchEvent(
      new CustomEvent("chat-messages-updated", {
        detail: { sessionId: session.id },
      }),
    );
    window.dispatchEvent(new CustomEvent("open-mini-chat"));
    setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent(CHAT_OPEN_SESSION_EVENT, {
            detail: { sessionId: session.id },
          }),
        ),
      150,
    );
  })().catch((error) => {
    const message = error instanceof Error ? error.message : "未知错误";
    window.alert(`分享 X 帖子失败：${message}`);
  });
}
