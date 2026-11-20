"use client";

import { useEffect, useMemo, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import {
  createTwitterId,
  knownTwitterAccount,
  snapshotTwitterPost,
  twitterRecognizes,
  twitterSnapshotText,
  type TwitterState,
  type TwitterSnapshot,
} from "@/lib/twitter-storage";
import { shareTwitterToChat } from "@/lib/twitter-sharing";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import {
  resolveUserIdentity,
  USER_IDENTITIES_UPDATED_EVENT,
} from "@/lib/settings-storage";
import { useUserIdentityPlatformProfile } from "@/components/character/use-user-identity-platform-profile";
import { AppDialog } from "../social/app-dialog";
import s from "../social/social.module.css";

function SnapshotPhoto({ refId }: { refId?: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let live = true;
    if (refId) {
      if (/^(https?:|data:)/.test(refId)) {
        setUrl(refId);
      } else {
        void getChatImageFromIndexedDB(refId).then((value) => {
          if (live) setUrl(value || "");
        });
      }
    }
    return () => {
      live = false;
    };
  }, [refId]);

  return url ? <img src={url} alt="帖子配图" /> : null;
}

export function TwitterSnapshotWindow({
  snapshot,
  onClose,
}: {
  snapshot: TwitterSnapshot;
  onClose: () => void;
}) {
  return (
    <AppDialog title="X 帖子快照" onClose={onClose}>
      <div className={s.snapshot}>
        {(snapshot.imageRefs?.length
          ? snapshot.imageRefs
          : [snapshot.imageRef]
        ).map((ref, index) => (
          <SnapshotPhoto key={index} refId={ref} />
        ))}
        <b>
          {snapshot.name} · @{snapshot.handle}
        </b>
        <p>{new Date(snapshot.createdAt).toLocaleString()}</p>
        {snapshot.imageDescription && <p>配图：{snapshot.imageDescription}</p>}
        {snapshot.original}
        {snapshot.translated && snapshot.translated !== snapshot.original && (
          <p>{snapshot.translated}</p>
        )}
      </div>
    </AppDialog>
  );
}

export function TwitterFrozenCard({ snapshot }: { snapshot: TwitterSnapshot }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={s.card} onClick={() => setOpen(true)}>
        <b>
          {snapshot.name} · @{snapshot.handle}
        </b>
        <br />
        {(snapshot.translated || snapshot.original).slice(0, 160)}
        <small> · 帖子快照</small>
      </button>
      {open && (
        <TwitterSnapshotWindow
          snapshot={snapshot}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function TwitterRecipientPicker({
  state,
  initialSender,
  initialRecipient,
  postId,
  onClose,
  onDone,
  commit,
}: {
  state: TwitterState;
  initialSender: string;
  initialRecipient?: string;
  postId?: string;
  onClose: () => void;
  onDone: (conversationId: string, sender: string) => void;
  commit: (fn: (state: TwitterState) => TwitterState) => void;
}) {
  const [sender, setSender] = useState(initialSender);
  const [recipient, setRecipient] = useState(initialRecipient || "");
  const [tab, setTab] = useState<"dm" | "chat">("dm");
  const [error, setError] = useState("");

  const [userIdentityRefresh, setUserIdentityRefresh] = useState(0);
  useEffect(() => {
    const refreshIdentity = () =>
      setUserIdentityRefresh((value) => value + 1);
    window.addEventListener(USER_IDENTITIES_UPDATED_EVENT, refreshIdentity);
    window.addEventListener("settings-bindings-updated", refreshIdentity);
    return () => {
      window.removeEventListener(USER_IDENTITIES_UPDATED_EVENT, refreshIdentity);
      window.removeEventListener("settings-bindings-updated", refreshIdentity);
    };
  }, []);

  const userIdentity = useMemo(
    () => resolveUserIdentity(undefined, "twitter"),
    [userIdentityRefresh],
  );
  const userPlatformProfile = useUserIdentityPlatformProfile(
    userIdentity?.id,
    "twitter",
  );
  const mainUserProfile = {
    ...state.profile,
    name:
      userPlatformProfile.nickname ||
      state.profile.name ||
      userIdentity?.name ||
      "我",
    avatarUrl:
      userPlatformProfile.avatarUrl ||
      state.profile.avatarUrl ||
      userIdentity?.avatarUrl ||
      "",
  };

  const chars = loadCharacters();
  const accounts = state.following
    .concat(state.importedCharacterIds)
    .filter((id, index, all) => !id.startsWith("user") && all.indexOf(id) === index);
  const targets = [
    ...new Set([
      ...accounts,
      ...state.conversations.map(
        (conversation) =>
          conversation.recipientAccountId || conversation.characterId,
      ),
      ...Object.keys(state.accounts).filter(
        (id) =>
          id.endsWith(":alt") &&
          !id.startsWith("user") &&
          twitterRecognizes(state, id, "user"),
      ),
    ]),
  ].filter((id) => knownTwitterAccount(state, id));

  // Only the X main User profile uses the five-platform identity record.
  // The User alternate account and character accounts remain independent.
  const profile = (id: string) =>
    id === "user"
      ? mainUserProfile
      : state.accounts[id] || state.characterProfiles[id];

  const person = (id: string, selected: boolean, click: () => void) => {
    const currentProfile = profile(id);
    return (
      <button
        key={id}
        className={s.person}
        aria-pressed={selected}
        onClick={click}
      >
        <span>
          {currentProfile?.avatarUrl ? (
            <img src={currentProfile.avatarUrl} alt="" />
          ) : (
            (currentProfile?.name || "X").slice(0, 1)
          )}
        </span>
        <b>
          {currentProfile?.name ||
            chars.find((character) => character.id === id)?.name ||
            "账号"}
        </b>
        <small>{id.endsWith(":alt") ? "小号" : "大号"}</small>
      </button>
    );
  };

  function proceed() {
    try {
      if (!recipient) return;
      let conversationId = "";
      commit((current) => {
        if (sender !== "user" && !current.accounts[sender]) {
          throw new Error("发送账号已删除");
        }
        if (!knownTwitterAccount(current, recipient)) {
          throw new Error("接收账号已不可用");
        }

        const characterId = recipient.replace(/:alt$/, "");
        const old = current.conversations.find(
          (conversation) =>
            conversation.characterId === characterId &&
            (conversation.userAccountId || "user") === sender &&
            (conversation.recipientAccountId || conversation.characterId) ===
              recipient,
        );
        if (old?.blocked) {
          throw new Error("这个会话已屏蔽，请先解除屏蔽");
        }

        conversationId = old?.id || createTwitterId();
        const messages = postId
          ? [
              {
                id: createTwitterId(),
                role: "user" as const,
                original: twitterSnapshotText(
                  snapshotTwitterPost(current, postId),
                ),
                postSnapshot: snapshotTwitterPost(current, postId),
                createdAt: Date.now(),
              },
            ]
          : [];

        return old
          ? {
              ...current,
              conversations: current.conversations.map((conversation) =>
                conversation.id === conversationId
                  ? {
                      ...conversation,
                      messages: [...conversation.messages, ...messages],
                    }
                  : conversation,
              ),
            }
          : {
              ...current,
              conversations: [
                {
                  id: conversationId,
                  characterId,
                  userAccountId: sender,
                  recipientAccountId: recipient,
                  mode: twitterRecognizes(current, sender, recipient)
                    ? ("real" as const)
                    : ("anonymous" as const),
                  messages,
                  createdAt: Date.now(),
                },
                ...current.conversations,
              ],
            };
      });
      onDone(conversationId, sender);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <AppDialog
      title={postId ? "分享帖子" : "选择私信账号"}
      onClose={onClose}
    >
      {error && <p className={s.error}>{error}</p>}
      {postId && (
        <div className={s.actions}>
          <button
            className={tab === "dm" ? s.primary : ""}
            onClick={() => setTab("dm")}
          >
            X 私信
          </button>
          <button
            className={tab === "chat" ? s.primary : ""}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
        </div>
      )}
      {tab === "dm" ? (
        <>
          <h4>使用账号</h4>
          <div className={s.grid}>
            {["user", ...(state.accounts["user:alt"] ? ["user:alt"] : [])].map(
              (id) =>
                person(id, sender === id, () => setSender(id)),
            )}
          </div>
          <h4>发送给</h4>
          <div className={s.grid}>
            {targets.map((id) =>
              person(id, recipient === id, () => setRecipient(id)),
            )}
          </div>
          {!targets.length && <p>先关注一个可联系的账号。</p>}
          <div className={s.actions}>
            <button
              className={s.primary}
              disabled={!recipient}
              onClick={proceed}
            >
              {postId ? "发送快照" : "进入私信"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            直接向 Chat 分享内容快照，不要求通过 X 账号认出作者。
          </p>
          <div className={s.grid}>
            {chars.map((character) => (
              <button
                className={s.person}
                key={character.id}
                onClick={() => {
                  try {
                    shareTwitterToChat(postId!, character.id);
                    onClose();
                  } catch (caught) {
                    setError((caught as Error).message);
                  }
                }}
              >
                <span>
                  {character.avatar ? (
                    <img src={character.avatar} alt="" />
                  ) : (
                    character.name.slice(0, 1)
                  )}
                </span>
                <b>{character.name}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </AppDialog>
  );
}
