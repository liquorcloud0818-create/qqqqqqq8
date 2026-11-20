import JSZip from "jszip";
import { hydrateKvDb, isKvHydrated, kvGet, kvRemove, kvSetAsync } from "@/lib/kv-db";

const PACKAGE_PREFIX = "lianhua.private.package.v1.";
const META_KEY = `${PACKAGE_PREFIX}meta`;
const REQUIRED_FILES = [
  "manifest.json",
  "presets.json",
  "index.html",
  "icon.png",
  "assets/hero-veil.webp",
  "assets/lianhua-lotus-tang.webp",
  "assets/lianhua-comic.webp",
] as const;

const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 8 * 1024 * 1024;

export type LianhuaPrivatePackageMeta = {
  id: "lianhua.tangda.bbs";
  name: "蓮華";
  version: "0.5.27";
  importedAt: number;
  archiveName: string;
  totalBytes: number;
};

export type LianhuaPrivateAssetPath =
  | "icon.png"
  | "assets/hero-veil.webp"
  | "assets/lianhua-lotus-tang.webp"
  | "assets/lianhua-comic.webp";

function storageKey(path: string): string {
  return `${PACKAGE_PREFIX}${path}`;
}

async function ensureLocalDatabaseReady(): Promise<void> {
  if (!isKvHydrated()) await hydrateKvDb();
  if (!isKvHydrated()) {
    throw new Error("本机数据库尚未完成读取，请刷新小手机后重试。");
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("本地素材转换失败。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("本地素材读取失败。"));
    reader.readAsDataURL(blob);
  });
}

async function readRequiredFile(zip: JSZip, path: string): Promise<Uint8Array> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`安装包缺少文件：${path}`);
  const bytes = await entry.async("uint8array");
  if (bytes.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new Error(`安装包中的文件过大：${path}`);
  }
  return bytes;
}

function decodeText(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} 不是有效的 UTF-8 文本。`);
  }
}

export function getLianhuaPrivatePackageMeta(): LianhuaPrivatePackageMeta | null {
  const raw = kvGet(META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LianhuaPrivatePackageMeta>;
    if (
      parsed.id !== "lianhua.tangda.bbs"
      || parsed.name !== "蓮華"
      || parsed.version !== "0.5.27"
      || typeof parsed.importedAt !== "number"
    ) return null;
    return parsed as LianhuaPrivatePackageMeta;
  } catch {
    return null;
  }
}

export function isLianhuaPrivatePackageInstalled(): boolean {
  return getLianhuaPrivatePackageMeta() !== null;
}

export function getLianhuaPrivateHtml(): string | null {
  return kvGet(storageKey("index.html"));
}

export function getLianhuaPrivatePresets(): string | null {
  return kvGet(storageKey("presets.json"));
}

export function getLianhuaPrivateManifest(): string | null {
  return kvGet(storageKey("manifest.json"));
}

export function getLianhuaPrivateAsset(path: LianhuaPrivateAssetPath): string | null {
  return kvGet(storageKey(path));
}

/**
 * Imports the frozen v0.5.27 archive into this browser profile's IndexedDB.
 * Nothing is uploaded and no public asset URL is created.
 */
export async function installLianhuaPrivateArchive(file: File): Promise<LianhuaPrivatePackageMeta> {
  if (!(file instanceof File)) throw new Error("请选择蓮華 v0.5.27 ZIP 安装包。");
  if (file.size <= 0 || file.size > MAX_ARCHIVE_BYTES) {
    throw new Error("安装包大小异常；ZIP 文件不得超过 15 MB。");
  }

  await ensureLocalDatabaseReady();

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file, { checkCRC32: true });
  } catch {
    throw new Error("ZIP 文件无法读取，请重新选择完整的蓮華 v0.5.27 安装包。");
  }

  const extracted = new Map<string, Uint8Array>();
  let totalBytes = 0;

  for (const path of REQUIRED_FILES) {
    const bytes = await readRequiredFile(zip, path);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("安装包解压后的文件总量超过 20 MB，已停止导入。");
    }
    extracted.set(path, bytes);
  }

  const manifestText = decodeText(extracted.get("manifest.json")!, "manifest.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    throw new Error("安装包 manifest.json 格式错误。");
  }

  if (
    manifest.id !== "lianhua.tangda.bbs"
    || manifest.name !== "蓮華"
    || manifest.version !== "0.5.27"
    || manifest.entry !== "index.html"
  ) {
    throw new Error("安装包身份不匹配。仅接受已确认的蓮華 v0.5.27 完整包。");
  }

  const html = decodeText(extracted.get("index.html")!, "index.html");
  const presets = decodeText(extracted.get("presets.json")!, "presets.json");
  try {
    JSON.parse(presets);
  } catch {
    throw new Error("安装包 presets.json 格式错误。");
  }
  if (!html.trim()) throw new Error("安装包 index.html 为空。");

  const values: Array<[string, string]> = [
    [storageKey("manifest.json"), manifestText],
    [storageKey("presets.json"), presets],
    [storageKey("index.html"), html],
  ];

  for (const path of ["icon.png", "assets/hero-veil.webp", "assets/lianhua-lotus-tang.webp", "assets/lianhua-comic.webp"] as const) {
    const blob = new Blob([extracted.get(path)!], {
      type: path.endsWith(".png") ? "image/png" : "image/webp",
    });
    values.push([storageKey(path), await blobToDataUrl(blob)]);
  }

  const meta: LianhuaPrivatePackageMeta = {
    id: "lianhua.tangda.bbs",
    name: "蓮華",
    version: "0.5.27",
    importedAt: Date.now(),
    archiveName: file.name.slice(0, 160) || "Lianhua_v0.5.27.zip",
    totalBytes,
  };

  try {
    for (const [key, value] of values) await kvSetAsync(key, value);
    // Write the install marker last; partially imported data is never reported as installed.
    await kvSetAsync(META_KEY, JSON.stringify(meta));
    return meta;
  } catch (error) {
    for (const [key] of values) kvRemove(key);
    kvRemove(META_KEY);
    throw error instanceof Error ? error : new Error("蓮華本机安装包保存失败。");
  }
}

/** Removes only this browser's private Lianhua package and leaves forum data untouched. */
export async function removeLianhuaPrivateArchive(): Promise<void> {
  await ensureLocalDatabaseReady();
  for (const path of [...REQUIRED_FILES, "meta"]) kvRemove(storageKey(path));
}
