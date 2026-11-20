"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, CheckCircle2, HardDrive, Upload } from "lucide-react";
import { hydrateKvDb, isKvHydrated } from "@/lib/kv-db";
import {
  getLianhuaPrivatePackageMeta,
  installLianhuaPrivateArchive,
  type LianhuaPrivatePackageMeta,
} from "@/lib/lianhua-private-storage";

type Props = {
  onNotice?: (message: string) => void;
  onInstalled?: () => void;
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--c-border, rgba(127,127,127,.2))",
  borderRadius: 18,
  padding: 16,
  background: "var(--c-card, rgba(127,127,127,.06))",
};

export function LianhuaPrivateInstaller({ onNotice, onInstalled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [meta, setMeta] = useState<LianhuaPrivatePackageMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isKvHydrated()) await hydrateKvDb();
      if (cancelled) return;
      if (!isKvHydrated()) {
        setError("本机数据读取失败。请刷新小手机后重新打开此页面。");
        return;
      }
      setMeta(getLianhuaPrivatePackageMeta());
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImport = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const installed = await installLianhuaPrivateArchive(file);
      setMeta(installed);
      window.dispatchEvent(new CustomEvent("lianhua-private-package-installed"));
      onInstalled?.();
      onNotice?.("蓮華 v0.5.27 已保存到本机");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "导入失败，请检查 ZIP 文件。";
      setError(message);
      onNotice?.(message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const formatBytes = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;

  return (
    <div style={{ display: "grid", gap: 14, padding: "4px 0 24px" }}>
      <section style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span
            aria-hidden="true"
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              display: "grid",
              placeItems: "center",
              background: "rgba(143,107,159,.16)",
              color: "#8f6b9f",
            }}
          >
            <Archive size={22} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>蓮華 · 唐大论坛</div>
            <div style={{ fontSize: 12, opacity: 0.62, marginTop: 3 }}>私人本机安装 · v0.5.27</div>
          </div>
        </div>

        <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.65, opacity: 0.78 }}>
          选择你保存的蓮華 v0.5.27 ZIP 完整包。安装文件只写入当前设备浏览器的本地数据库，不会上传到服务器，也不会加入其他用户的默认桌面。
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          aria-label="选择蓮華 v0.5.27 ZIP 安装包"
          disabled={busy || !ready}
          onChange={(event) => void handleImport(event.currentTarget.files?.[0])}
          style={{ display: "none" }}
        />

        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => inputRef.current?.click()}
          style={{
            width: "100%",
            minHeight: 46,
            border: 0,
            borderRadius: 13,
            padding: "11px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: "#fff",
            background: "#8f6b9f",
            fontWeight: 650,
            fontSize: 14,
            opacity: busy || !ready ? 0.55 : 1,
            cursor: busy || !ready ? "not-allowed" : "pointer",
          }}
        >
          <Upload size={17} />
          {busy ? "正在校验并保存到本机…" : meta ? "重新导入 ZIP 安装包" : "选择 ZIP 安装包"}
        </button>

        {!ready && !error ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.62 }}>正在读取本机存储…</div>
        ) : null}

        {error ? (
          <div role="alert" style={{ marginTop: 12, color: "var(--c-danger, #d65b5b)", fontSize: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        ) : null}
      </section>

      {meta ? (
        <section style={cardStyle} aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#438b66", fontWeight: 650 }}>
            <CheckCircle2 size={18} />
            本机安装包已保存
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 7, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ opacity: 0.62 }}>版本</span>
              <span>v{meta.version}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ opacity: 0.62 }}>文件</span>
              <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{meta.archiveName}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ opacity: 0.62 }}>保存内容</span>
              <span>{formatBytes(meta.totalBytes)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ opacity: 0.62 }}>存储位置</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <HardDrive size={13} /> 当前设备浏览器
              </span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
