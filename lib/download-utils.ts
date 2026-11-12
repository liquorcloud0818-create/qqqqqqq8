export type DownloadFileOptions = {
    disableNativeShare?: boolean;
    nativeShareOnly?: boolean;
};

type AndroidShellDownloadBridge = {
    beginDownload: (filename: string, mimeType: string) => string;
    appendDownloadChunk: (token: string, base64Chunk: string) => boolean;
    finishDownload: (token: string) => boolean;
    abortDownload: (token: string) => void;
};

export function isAndroidBrowser(): boolean {
    return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function isIOSBrowser(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}


function getAndroidShellDownloadBridge(): AndroidShellDownloadBridge | null {
    if (typeof window === "undefined") return null;
    const bridge = (window as Window & {
        AndroidShell?: AndroidShellDownloadBridge
    }).AndroidShell;

    return bridge
        && typeof bridge.beginDownload === "function"
        && typeof bridge.appendDownloadChunk === "function"
        && typeof bridge.finishDownload === "function"
        && typeof bridge.abortDownload === "function"
        ? bridge
        : null;
}

function readBlobChunkAsBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.onerror = () => reject(reader.error || new Error("读取导出文件失败"));
        reader.readAsDataURL(blob);
    });
}

async function downloadThroughAndroidShell(
    blob: Blob,
    filename: string,
    bridge: AndroidShellDownloadBridge
): Promise<void> {
    const token = bridge.beginDownload(
        filename,
        blob.type || "application/octet-stream"
    );
    if (!token) throw new Error("Android 文件保存初始化失败");

    try {
        // 255 KiB 可被 3 整除，保证 Base64 分块拼接正确。
        const chunkSize = 255 * 1024;
        for (let offset = 0; offset < blob.size; offset += chunkSize) {
            const base64 = await readBlobChunkAsBase64(
                blob.slice(offset, offset + chunkSize)
            );
            if (!bridge.appendDownloadChunk(token, base64)) {
                throw new Error("写入导出文件失败");
            }
        }
        if (!bridge.finishDownload(token)) {
            throw new Error("保存导出文件失败");
        }
    } catch (error) {
        bridge.abortDownload(token);
        throw error;
    }
}

export async function downloadFile(blob: Blob, filename: string, options: DownloadFileOptions = {}): Promise<void> {
    const androidBridge = getAndroidShellDownloadBridge();
    if (androidBridge) {
        await downloadThroughAndroidShell(blob, filename, androidBridge);
        return;
    }

    if (typeof navigator !== "undefined"
        && /FloatShell\//i.test(navigator.userAgent || "")) {
        throw new Error("当前 APK 版本不支持文件导出，请更新应用后重试。");
    }

    const url = URL.createObjectURL(blob);
    const anchorDownload = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    const shouldUseNativeShare = options.nativeShareOnly || (!options.disableNativeShare && isIOSBrowser());
    if (shouldUseNativeShare) {
        const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
        const canNativeShare = typeof navigator !== "undefined"
            && typeof navigator.share === "function"
            && typeof navigator.canShare === "function"
            && navigator.canShare({ files: [file] });
        if (canNativeShare) {
            try {
                await navigator.share({ files: [file] });
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return;
            } catch (err) {
                // User explicitly dismissed the share sheet → respect it, don't force a download.
                if (err instanceof DOMException && err.name === "AbortError") {
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    return;
                }
                // Any other failure (webview without real file-share support, lost user
                // activation, etc.) is surfaced to the caller on iOS instead of opening
                // the blob URL, which can navigate away from the app.
            }
        }
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        throw new Error("当前浏览器没有成功打开系统分享，请在 Safari 中重试，或导出轻量备份后再试。");
    }

    anchorDownload();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
    let blob: Blob | null = null;

    try {
        const res = await fetch(url);
        if (res.ok) blob = await res.blob();
    } catch { /* CORS or network error — try proxy */ }

    if (!blob && /^https?:\/\//.test(url)) {
        try {
            const res = await fetch("/api/tool-proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, method: "GET" }),
            });
            if (res.ok) blob = await res.blob();
        } catch { /* proxy also failed */ }
    }

    if (blob) {
        await downloadFile(blob, filename);
    } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}
