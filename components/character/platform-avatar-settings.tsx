"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { resolvePlatformAvatarAsset, savePlatformAvatarAsset } from "@/lib/platform-avatar-storage";
import { CUSTOM_APPS_UPDATED_EVENT, loadInstalledCustomApps } from "@/lib/custom-app-storage";

type PlatformOption = { id: string; name: string; kind: "built-in" | "custom" };

type Props = {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  nicknames: Record<string, string>;
  onNicknamesChange: (next: Record<string, string>) => void;
  editing: boolean;
  onNotice?: (message: string) => void;
};

const BUILT_IN_PLATFORMS: PlatformOption[] = [
  { id: "chat", name: "聊天", kind: "built-in" },
  { id: "moments", name: "朋友圈", kind: "built-in" },
  { id: "twitter", name: "X / Twitter", kind: "built-in" },
  { id: "weibo", name: "微博", kind: "built-in" },
  { id: "xiaohongshu", name: "小红书", kind: "built-in" },
  { id: "douyin", name: "抖音", kind: "built-in" },
  { id: "instagram", name: "Instagram", kind: "built-in" },
  { id: "reddit", name: "Reddit", kind: "built-in" },
  { id: "bilibili", name: "哔哩哔哩", kind: "built-in" },
  { id: "douban", name: "豆瓣", kind: "built-in" },
  { id: "telegram", name: "Telegram", kind: "built-in" },
  { id: "weverse", name: "Weverse", kind: "built-in" },
  { id: "lysn", name: "Lysn", kind: "built-in" },
  { id: "steam", name: "Steam", kind: "built-in" },
];

export function PlatformAvatarSettings({ value, onChange, nicknames, onNicknamesChange, editing, onNotice }: Props) {
  const [customApps, setCustomApps] = useState<PlatformOption[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const refresh = () => {
      const apps = loadInstalledCustomApps().map(app => ({
        id: `custom:${app.id}`,
        name: app.name || "自定义 APP",
        kind: "custom" as const,
      })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      setCustomApps(apps);
    };
    refresh();
    window.addEventListener(CUSTOM_APPS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(CUSTOM_APPS_UPDATED_EVENT, refresh);
  }, []);

  useEffect(() => {
    let active = true;
    const entries = Object.entries(value).filter(([, assetId]) => Boolean(assetId));
    Promise.all(entries.map(async ([platformId, assetId]) => [platformId, await resolvePlatformAvatarAsset(assetId)] as const))
      .then(resolved => {
        if (!active) return;
        setPreviews(current => {
          const next = { ...current };
          for (const [platformId, src] of resolved) {
            if (src) next[platformId] = src;
            else delete next[platformId];
          }
          for (const platformId of Object.keys(next)) if (!value[platformId]) delete next[platformId];
          return next;
        });
      });
    return () => { active = false; };
  }, [value]);

  const platforms = [...BUILT_IN_PLATFORMS, ...customApps];
  const visiblePlatforms = editing
    ? platforms
    : platforms.filter(platform => Boolean(value[platform.id] && previews[platform.id]));

  async function handleFile(platformId: string, file?: File) {
    if (!file) return;
    setBusyId(platformId);
    try {
      const assetId = await savePlatformAvatarAsset(file);
      onChange({ ...value, [platformId]: assetId });
      const preview = await resolvePlatformAvatarAsset(assetId);
      if (preview) setPreviews(current => ({ ...current, [platformId]: preview }));
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
    setPreviews(current => {
      const updated = { ...current };
      delete updated[platformId];
      return updated;
    });
  }

  return (
    <section className="char-log-entry mb-4 border-t border-dashed border-[#999] pt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="char-log-entry-header !mb-0">PLATFORM PROFILES / 各平台独立资料</span>
        {editing && <span className="ts-10 opacity-60">头像从设备选择，昵称手动填写</span>}
      </div>
      <p className="ts-10 opacity-60 mt-1 mb-3">
        每个平台单独保存头像和昵称，不会覆盖角色主头像或主名称。昵称留空时沿用角色主名称；完成后点击档案底部 SAVE。
      </p>

      {visiblePlatforms.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visiblePlatforms.map(platform => {
            const selected = Boolean(value[platform.id]);
            const busy = busyId === platform.id;
            return (
              <div key={platform.id} className="flex items-center gap-3 min-w-0 rounded-lg border border-[var(--c-panel-border)] p-2">
                <div className="w-11 h-11 shrink-0 overflow-hidden rounded-full bg-[var(--c-input)] border border-[var(--c-panel-border)] flex items-center justify-center">
                  {previews[platform.id]
                    ? <img src={previews[platform.id]} alt={`${platform.name}头像`} className="w-full h-full object-cover" />
                    : <span className="ts-10 opacity-40">{selected ? "…" : "无"}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{platform.name}</div>
                  <div className="ts-10 opacity-55">{selected ? "已设置独立头像" : "未单独设置头像"}</div>
                  {editing && (
                    <input
                      type="text"
                      maxLength={48}
                      value={nicknames[platform.id] || ""}
                      onChange={event => onNicknamesChange({ ...nicknames, [platform.id]: event.target.value })}
                      placeholder="平台昵称（留空使用角色主名）"
                      aria-label={`${platform.name}平台昵称`}
                      className="mt-1 w-full min-w-0 rounded border border-[var(--c-panel-border)] bg-[var(--c-input)] px-2 py-1 text-xs"
                    />
                  )}
                  {!editing && nicknames[platform.id] && <div className="ts-10 opacity-65 truncate">昵称：{nicknames[platform.id]}</div>}
                </div>
                {editing && (
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      ref={node => { inputs.current[platform.id] = node; }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy}
                      onChange={event => { void handleFile(platform.id, event.target.files?.[0]); }}
                    />
                    <button type="button" className="p-2 rounded-md border border-[var(--c-panel-border)] hover:bg-[var(--c-input)] disabled:opacity-40" title="上传头像" aria-label={`为${platform.name}上传头像`} disabled={busy} onClick={() => inputs.current[platform.id]?.click()}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                    </button>
                    {selected && (
                      <button type="button" className="p-2 rounded-md border border-[var(--c-panel-border)] hover:bg-[var(--c-input)]" title="清除独立头像" aria-label={`清除${platform.name}独立头像`} onClick={() => clearAvatar(platform.id)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <p className="ts-10 opacity-55">尚未设置平台独立资料。</p>}
    </section>
  );
}
