"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import {
  resolvePlatformAvatarAsset,
  savePlatformAvatarAsset,
} from "@/lib/platform-avatar-storage";

type PlatformOption = { id: string; name: string };

type Props = {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  nicknames: Record<string, string>;
  onNicknamesChange: (next: Record<string, string>) => void;
  editing: boolean;
  onNotice?: (message: string) => void;
};

const BUILT_IN_PLATFORMS: PlatformOption[] = [
  { id: "chat", name: "聊天 / 朋友圈" },
  { id: "twitter", name: "X" },
  { id: "weibo", name: "微博" },
  { id: "douyin", name: "抖音" },
  { id: "xiaohongshu", name: "小红书" },
];

export function PlatformAvatarSettings({
  value,
  onChange,
  nicknames,
  onNicknamesChange,
  editing,
  onNotice,
}: Props) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let active = true;
    const entries = Object.entries(value).filter(([, assetId]) => Boolean(assetId));

    Promise.all(
      entries.map(async ([platformId, assetId]) =>
        [platformId, await resolvePlatformAvatarAsset(assetId)] as const,
      ),
    ).then((resolved) => {
      if (!active) return;
      setPreviews((current) => {
        const next = { ...current };
        for (const [platformId, src] of resolved) {
          if (src) next[platformId] = src;
          else delete next[platformId];
        }
        for (const platformId of Object.keys(next)) {
          if (!value[platformId]) delete next[platformId];
        }
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [value]);

  const visiblePlatforms = editing
    ? BUILT_IN_PLATFORMS
    : BUILT_IN_PLATFORMS.filter((platform) =>
        Boolean(value[platform.id] || nicknames[platform.id]?.trim()),
      );

  async function handleFile(platformId: string, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onNotice?.("请选择图片文件。");
      return;
    }

    setBusyId(platformId);
    try {
      const assetId = await savePlatformAvatarAsset(file);
      const preview = await resolvePlatformAvatarAsset(assetId);
      onChange({ ...value, [platformId]: assetId });
      setPreviews((current) => {
        const next = { ...current };
        if (preview) next[platformId] = preview;
        else delete next[platformId];
        return next;
      });
      onNotice?.("平台头像已载入，点击档案底部 SAVE 保存设置。");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "头像上传失败，请重试。");
    } finally {
      setBusyId(null);
      const input = inputs.current[platformId];
      if (input) input.value = "";
    }
  }

  function clearAvatar(platformId: string) {
    const next = { ...value };
    delete next[platformId];
    onChange(next);
    setPreviews((current) => {
      const updated = { ...current };
      delete updated[platformId];
      return updated;
    });
  }

  return (
    <section className="char-log-entry mb-4 border-t border-dashed border-[#999] pt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center bg-[#303844] px-3 py-2 text-sm font-semibold tracking-wide text-white">
          PLATFORM PROFILES / 各平台独立资料
        </span>
        {editing && <span className="ts-10 opacity-60">头像从设备选择，昵称手动填写</span>}
      </div>

      <p className="ts-10 opacity-60 mt-2 mb-4 leading-relaxed">
        每个平台单独保存头像和昵称，不会覆盖角色主头像或主名称。昵称留空时沿用角色主名称；完成后点击档案底部 SAVE。
      </p>

      {visiblePlatforms.length > 0 ? (
        <div className="flex flex-col gap-3">
          {visiblePlatforms.map((platform) => {
            const selected = Boolean(value[platform.id]);
            const nickname = nicknames[platform.id] || "";
            const busy = busyId === platform.id;
            const preview = previews[platform.id];

            return (
              <article
                key={platform.id}
                className="flex w-full min-w-0 items-center gap-3 rounded-[26px] border border-[var(--c-panel-border)] bg-[var(--c-panel)] p-3 sm:gap-4 sm:p-4"
              >
                <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--c-panel-border)] bg-[var(--c-input)] sm:h-[88px] sm:w-[88px]">
                  {preview ? (
                    <img
                      src={preview}
                      alt={`${platform.name}平台头像`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-base text-[var(--c-text-secondary)] opacity-60">
                      {selected ? "…" : "无"}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold leading-tight text-[var(--c-text-title)] sm:text-lg">
                    {platform.name}
                  </div>
                  <div className="mt-1 text-xs text-[var(--c-text-secondary)] sm:text-sm">
                    {selected ? "已设置独立头像" : "未单独设置头像"}
                  </div>

                  {editing ? (
                    <input
                      type="text"
                      maxLength={48}
                      value={nickname}
                      onChange={(event) =>
                        onNicknamesChange({
                          ...nicknames,
                          [platform.id]: event.target.value,
                        })
                      }
                      placeholder="平台昵称（留空使用角色主名）"
                      aria-label={`${platform.name}平台昵称`}
                      className="mt-2 h-11 w-full min-w-0 rounded-lg border border-[var(--c-panel-border)] bg-[var(--c-input)] px-3 text-sm text-[var(--c-text)] placeholder:text-[var(--c-text-secondary)] sm:h-12 sm:text-base"
                    />
                  ) : nickname ? (
                    <div className="mt-1 truncate text-sm text-[var(--c-text-secondary)]">
                      昵称：{nickname}
                    </div>
                  ) : null}
                </div>

                {editing && (
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <input
                      ref={(node) => {
                        inputs.current[platform.id] = node;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy}
                      onChange={(event) => {
                        void handleFile(platform.id, event.target.files?.[0]);
                      }}
                    />
                    <button
                      type="button"
                      className="flex h-[62px] w-[62px] items-center justify-center rounded-[18px] border border-[var(--c-panel-border)] bg-[var(--c-panel)] text-[var(--c-text)] hover:bg-[var(--c-input)] disabled:opacity-40 sm:h-[72px] sm:w-[72px]"
                      title="从设备选择头像"
                      aria-label={`为${platform.name}选择头像`}
                      disabled={busy}
                      onClick={() => inputs.current[platform.id]?.click()}
                    >
                      {busy ? <Loader2 size={24} className="animate-spin" /> : <ImagePlus size={26} />}
                    </button>
                    {selected && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-1 py-0.5 text-[10px] text-[var(--c-text-secondary)] hover:text-[var(--c-text)]"
                        title="清除独立头像"
                        aria-label={`清除${platform.name}独立头像`}
                        onClick={() => clearAvatar(platform.id)}
                      >
                        <Trash2 size={11} />
                        移除
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="ts-10 opacity-55">尚未设置平台独立资料。</p>
      )}
    </section>
  );
}
