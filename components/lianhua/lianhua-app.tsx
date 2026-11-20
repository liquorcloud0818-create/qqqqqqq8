"use client";

import { useEffect, useRef, useState } from "react";
import {
  getLianhuaPrivateAsset,
  getLianhuaPrivateHtml,
  isLianhuaPrivatePackageInstalled,
} from "@/lib/lianhua-private-storage";
import { hydrateKvDb, isKvHydrated, kvGet, kvSet } from "@/lib/kv-db";
import { loadCharacters } from "@/lib/character-storage";
import { loadWorldBooks, resolveUserIdentity } from "@/lib/settings-storage";
import { loadUserIdentityPlatformProfiles } from "@/lib/user-platform-profile-storage";
import { loadMemoryEntries, loadMemoryEntriesByType } from "@/lib/memory-storage";
import { loadChatMessages, loadChatSessions, type ChatMessage, type ChatSession } from "@/lib/chat-storage";
import { generateChatCompletion, flattenCompletionResult } from "@/lib/chat-engine";
import { resolvePlatformAvatarAsset } from "@/lib/platform-avatar-storage";
import type { Character } from "@/lib/character-types";

type Props = {
  visible: boolean;
  onNotice?: (message: string) => void;
};

type LianhuaUserContext = {
  studentNumber: string;
  roleCode: string;
  authorizedRoles: string[];
  displayName: string;
  avatarUrl: string;
  isTangdaStudent: boolean;
  campusIdentity: Record<string, unknown>;
  platformProfiles: Record<string, unknown>;
};

type LianhuaNativeWindow = Window & {
  AiPhone?: Record<string, any>;
  AiPhoneApp?: Record<string, any>;
  __LIANHUA_NATIVE_ROOT__?: HTMLElement;
  __LIANHUA_USER_CONTEXT__?: LianhuaUserContext | null;
  __LIANHUA_LOCAL_GET__?: (key: string) => string | null;
  __LIANHUA_LOCAL_SET__?: (key: string, value: string) => boolean;
  _toast?: ReturnType<typeof setTimeout>;
};

const PRIVATE_LOCAL_PREFIX = "lianhua.private.local.v1.";
const PRIVATE_TABLE_PREFIX = "lianhua.private.table.v1.";
const PRIVATE_MEDIA_PREFIX = "lianhua.private.media.v1.";

const DEPARTMENT_NAMES: Record<string, string> = {
  "01": "法学部",
  "02": "经济学部",
  "03": "文学部",
  "04": "理学部",
  "05": "工学部",
  "06": "国际关系部",
};

const UNION_DEPARTMENT_NAMES: Record<string, string> = {
  "01": "办公室",
  "02": "宣传部",
  "03": "文艺部",
  "04": "体育部",
  "05": "生活权益部",
  "06": "外联部",
  "07": "社团管理部",
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readPrivateTable(table: string): Array<Record<string, any>> {
  return parseJson<Array<Record<string, any>>>(kvGet(`${PRIVATE_TABLE_PREFIX}${table}`), []);
}

function writePrivateTable(table: string, rows: Array<Record<string, any>>): void {
  kvSet(`${PRIVATE_TABLE_PREFIX}${table}`, JSON.stringify(rows));
}

function toCharacterForForum(character: Character): Record<string, any> {
  const campus = character.campusIdentity ?? {};
  const departmentCode = campus.departmentCode ?? "";
  const unionDepartmentCode = campus.studentUnionDepartmentCode ?? "";
  const unionRoleCode = deriveUnionRoleCode(campus as Record<string, unknown>);

  return {
    ...character,
    campusIdentity: campus,
    campus: {
      university: campus.isTangdaStudent ? "棠大" : "",
      school: campus.isTangdaStudent ? "国立综合大学" : "",
      studentId: campus.studentNumber ?? "",
      department: DEPARTMENT_NAMES[departmentCode] ?? "",
      studentUnionDepartment: UNION_DEPARTMENT_NAMES[unionDepartmentCode] ?? "",
    },
    isTangda: campus.isTangdaStudent === true,
    isTangdaStudent: campus.isTangdaStudent === true,
    campusStudent: campus.isTangdaStudent === true,
    studentId: campus.studentNumber ?? "",
    university: campus.isTangdaStudent ? "棠大" : "",
    school: campus.isTangdaStudent ? "国立综合大学" : "",
    department: DEPARTMENT_NAMES[departmentCode] ?? "",
    roleCode: unionRoleCode,
    campusRoleCode: unionRoleCode,
    studentUnionRole: unionRoleCode,
    studentUnionDepartment: UNION_DEPARTMENT_NAMES[unionDepartmentCode] ?? "",
    studentUnionDepartmentCode: unionDepartmentCode,
    source: "phone",
  };
}

function deriveUnionRoleCode(campus: Record<string, unknown> | undefined): string {
  if (!campus || campus.hasStudentUnionIdentity !== true) return "";
  const explicit = String(campus.studentUnionLoginCode ?? "").trim().toUpperCase();
  if (/^(S00|S0|D0[1-7]|D1[1-7])$/.test(explicit)) return explicit;

  const department = String(campus.studentUnionDepartmentCode ?? "");
  switch (campus.studentUnionRole) {
    case "chair": return "S00";
    case "vice_chair": return "S0";
    case "department_account": return /^0[1-7]$/.test(department) ? `D${department}` : "";
    case "department_head": return /^0[1-7]$/.test(department) ? `D1${department.slice(1)}` : "";
    default: return "";
  }
}

async function getNativeUserContext(): Promise<LianhuaUserContext | null> {
  const identity = resolveUserIdentity(undefined, "lianhua");
  if (!identity) return null;

  const campus = identity.campusIdentity as Record<string, unknown> | undefined;
  const studentNumber = String(campus?.studentNumber ?? "").trim().toUpperCase();
  if (
    campus?.isTangdaStudent !== true
    || !/^[SY]\d{7}$/.test(studentNumber)
  ) {
    return null;
  }

  const roleCode = deriveUnionRoleCode(campus);
  const profiles = loadUserIdentityPlatformProfiles(identity.id);
  let avatarUrl = identity.avatarUrl ?? "";
  const chatProfile = profiles.chat as { avatarAssetId?: string; nickname?: string } | undefined;
  if (chatProfile?.avatarAssetId) {
    avatarUrl = (await resolvePlatformAvatarAsset(chatProfile.avatarAssetId)) || avatarUrl;
  }

  return {
    studentNumber,
    roleCode,
    authorizedRoles: roleCode ? [roleCode] : [],
    displayName: chatProfile?.nickname?.trim() || identity.name || "棠大学生",
    avatarUrl,
    isTangdaStudent: true,
    campusIdentity: campus ?? {},
    platformProfiles: profiles,
  };
}

function makeCharacterApi() {
  const findCharacter = (input: unknown): Character | undefined => {
    const id = typeof input === "string"
      ? input
      : String((input as Record<string, unknown> | null)?.characterId ?? (input as Record<string, unknown> | null)?.id ?? "");
    return loadCharacters().find(character => character.id === id);
  };

  return {
    list: async () => loadCharacters().map(toCharacterForForum),
    get: async (input: unknown) => {
      const character = findCharacter(input);
      return character ? { character: toCharacterForForum(character) } : null;
    },
    readState: async (input: unknown) => {
      const character = findCharacter(input);
      if (!character) return { text: "" };
      const record = character as Character & Record<string, unknown>;
      return {
        characterId: character.id,
        state: record.currentState ?? record.state ?? record.status ?? null,
        text: [record.currentState, record.state, record.status].filter(Boolean).map(String).join("\n"),
      };
    },
    readRelations: async (input: unknown) => {
      const character = findCharacter(input);
      if (!character) return { text: "", relations: [] };
      const record = character as Character & Record<string, unknown>;
      const relations = record.relationships ?? record.relations ?? record.characterRelations ?? [];
      return {
        characterId: character.id,
        relations: Array.isArray(relations) ? relations : [],
        text: Array.isArray(relations) ? JSON.stringify(relations) : String(relations ?? ""),
      };
    },
  };
}

function makeDatabaseApi() {
  return {
    list: async (table: string, options?: { limit?: number }) => {
      const limit = Math.max(1, Math.min(5000, Number(options?.limit ?? 1000) || 1000));
      return { records: readPrivateTable(table).slice(0, limit) };
    },
    create: async (table: string, data: Record<string, any>) => {
      const rows = readPrivateTable(table);
      const id = String(data.id ?? makeId(table));
      const record = { ...data, id, _sdkId: id };
      const existingIndex = rows.findIndex(row => row._sdkId === id || row.id === id);
      if (existingIndex >= 0) rows[existingIndex] = record;
      else rows.unshift(record);
      writePrivateTable(table, rows);
      return { id, record };
    },
    update: async (table: string, id: string, patch: Record<string, any>) => {
      const rows = readPrivateTable(table);
      const index = rows.findIndex(row => row._sdkId === id || row.id === id);
      if (index < 0) return { id, updated: false };
      rows[index] = { ...rows[index], ...patch, _sdkId: rows[index]._sdkId ?? id };
      writePrivateTable(table, rows);
      return { id, updated: true, record: rows[index] };
    },
    delete: async (table: string, id: string) => {
      const rows = readPrivateTable(table);
      writePrivateTable(table, rows.filter(row => row._sdkId !== id && row.id !== id));
      return { id, deleted: true };
    },
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("图片读取失败。"));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function makeMediaApi(root: HTMLElement) {
  return {
    pick: async (options?: { accept?: string }) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = options?.accept ?? "image/*";
      input.style.display = "none";
      root.appendChild(input);

      try {
        const file = await new Promise<File | null>(resolve => {
          input.onchange = () => resolve(input.files?.[0] ?? null);
          input.addEventListener("cancel", () => resolve(null), { once: true });
          input.click();
        });
        if (!file) return null;
        return { file: { name: file.name, type: file.type, dataUrl: await fileToDataUrl(file) } };
      } finally {
        input.remove();
      }
    },
    put: async (input: { dataUrl?: string }) => {
      const dataUrl = String(input?.dataUrl ?? "");
      if (!dataUrl.startsWith("data:image/")) throw new Error("仅支持保存图片素材。");
      const ref = makeId("media");
      kvSet(`${PRIVATE_MEDIA_PREFIX}${ref}`, dataUrl);
      return { ref };
    },
    get: async (input: { ref?: string }) => {
      const ref = String(input?.ref ?? "");
      const dataUrl = ref ? kvGet(`${PRIVATE_MEDIA_PREFIX}${ref}`) : null;
      return dataUrl ? { ref, dataUrl } : null;
    },
  };
}

function makeMemoryApi() {
  return {
    readCore: async (input: { characterId?: string }) => {
      const rows = input?.characterId ? await loadMemoryEntriesByType(input.characterId, "core") : [];
      return { entries: rows, text: rows.map(row => row.content).join("\n\n") };
    },
    readLongTerm: async (input: { characterId?: string; query?: string; limit?: number }) => {
      const rows = input?.characterId ? await loadMemoryEntriesByType(input.characterId, "long_term") : [];
      const query = String(input?.query ?? "").trim().toLowerCase();
      const filtered = query ? rows.filter(row => row.content.toLowerCase().includes(query)) : rows;
      const entries = filtered.slice(-Math.max(1, Math.min(100, input?.limit ?? 8)));
      return { entries, text: entries.map(row => row.content).join("\n\n") };
    },
    readShortTerm: async (input: { characterId?: string; limit?: number }) => {
      const characterId = String(input?.characterId ?? "");
      const sessions = loadChatSessions().filter(session => session.contactId === characterId);
      const limit = Math.max(1, Math.min(100, input?.limit ?? 8));
      const messages = sessions.flatMap(session => loadChatMessages(session.id).slice(-limit));
      const recent = messages.slice(-limit);
      return { items: recent, text: recent.map(message => message.content).filter(Boolean).join("\n\n") };
    },
    search: async (input: { characterId?: string; query?: string; limit?: number }) => {
      const characterId = String(input?.characterId ?? "");
      const query = String(input?.query ?? "").trim().toLowerCase();
      if (!characterId || !query) return { entries: [] };
      const rows = await loadMemoryEntries(characterId);
      return {
        entries: rows
          .filter(row => row.content.toLowerCase().includes(query))
          .sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)))
          .slice(0, Math.max(1, Math.min(100, input?.limit ?? 8))),
      };
    },
  };
}

function makeAiApi() {
  return {
    chat: async (input: {
      messages?: Array<{ role?: string; content?: string }>;
      timeoutMs?: number;
    }) => {
      const characters = loadCharacters();
      const character = characters.find(item => item.campusIdentity?.isTangdaStudent) ?? characters[0];
      if (!character) {
        throw new Error("蓮華的 AI 动态需要至少一个已建立的小手机角色，并且该角色已配置可用的 AI 接口。");
      }

      const messages = Array.isArray(input?.messages) ? input.messages : [];
      const system = messages.filter(item => item.role === "system").map(item => item.content ?? "").join("\n\n");
      const user = messages.filter(item => item.role !== "system").map(item => item.content ?? "").join("\n\n");
      const prompt = [system ? `【本轮任务与规则】\n${system}` : "", user ? `【本轮输入】\n${user}` : ""].filter(Boolean).join("\n\n");
      const sessionId = makeId("lianhua-generation");
      const now = new Date().toISOString();
      const session = {
        id: sessionId,
        contactId: character.id,
        unreadCount: 0,
        updatedAt: now,
        isPinned: false,
        bilingualTranslationEnabled: false,
        collapseBilingualTranslation: true,
      } as ChatSession;
      const message = {
        id: makeId("lianhua-prompt"),
        sessionId,
        role: "user",
        content: prompt,
        status: "sent",
        createdAt: now,
        order: 0,
      } as ChatMessage;

      const result = await generateChatCompletion(session, [message], {
        appId: "lianhua",
        appTags: ["lianhua", "campus-forum"],
        toolsAllowed: false,
      });
      return { text: flattenCompletionResult(result) };
    },
  };
}

function makeNativeApi(root: HTMLElement) {
  const characters = makeCharacterApi();
  const db = makeDatabaseApi();
  const media = makeMediaApi(root);
  const worlds = {
    list: async () => ({ books: loadWorldBooks() }),
  };
  const memory = makeMemoryApi();
  const ai = makeAiApi();

  return {
    app: {
      getAssetUrl: async (path: string) => getLianhuaPrivateAsset(path as Parameters<typeof getLianhuaPrivateAsset>[0]),
    },
    db,
    media,
    characters,
    world: worlds,
    memory,
    ai,
  };
}

function splitSelectors(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let quote = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") parens++;
    else if (char === ")") parens--;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === "," && parens === 0 && brackets === 0) {
      result.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}

function findRuleBoundary(source: string, start: number): number {
  let parens = 0;
  let brackets = 0;
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") parens++;
    else if (char === ")") parens--;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (parens === 0 && brackets === 0 && (char === "{" || char === "}" || char === ";")) return i;
  }
  return source.length;
}

function findMatchingBrace(source: string, open: number): number {
  let depth = 1;
  let quote = "";
  for (let i = open + 1; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return source.length;
}

function scopeSelector(selector: string, scope: string): string {
  const value = selector.trim();
  if (!value) return value;
  if (/^(?:html|body|:root)(?=$|[\s.#:[>+~])/.test(value)) {
    return scope + value.replace(/^(?:html|body|:root)/, "");
  }
  return `${scope} ${value}`;
}

function scopeStylesheet(css: string): string {
  const scope = ".lianhua-native-root";

  const rewrite = (source: string): string => {
    let output = "";
    let cursor = 0;

    while (cursor < source.length) {
      const boundary = findRuleBoundary(source, cursor);
      if (boundary >= source.length) {
        output += source.slice(cursor);
        break;
      }

      const head = source.slice(cursor, boundary);
      const token = source[boundary];

      if (token === ";") {
        output += head + ";";
        cursor = boundary + 1;
        continue;
      }
      if (token === "}") {
        output += head + "}";
        cursor = boundary + 1;
        continue;
      }

      const close = findMatchingBrace(source, boundary);
      const body = source.slice(boundary + 1, close);
      const prelude = head.trim();
      const semanticPrelude = prelude.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (semanticPrelude.startsWith("@")) {
        if (/^@(?:-\w+-)?keyframes\b/i.test(semanticPrelude)) {
          output += head + "{" + body + "}";
        } else if (/^@(media|supports|container|layer|document|scope|starting-style)\b/i.test(semanticPrelude)) {
          output += head + "{" + rewrite(body) + "}";
        } else {
          output += head + "{" + body + "}";
        }
      } else {
        const leading = head.match(/^\s*/)?.[0] ?? "";
        const comments = (head.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/) ?? [""])[0];
        const selectorText = head.slice(comments.length).trim();
        const selectors = splitSelectors(selectorText).map(item => scopeSelector(item, scope));
        output += leading + (comments.trim() ? comments : "") + selectors.join(", ") + "{" + body + "}";
      }
      cursor = Math.min(source.length, close + 1);
    }

    return output;
  };

  return rewrite(css);
}

function patchForumScript(source: string): string {
  let script = source;

  script = script.replace(
    'const $=id=>document.getElementById(id);',
    'const $=id=>window.__LIANHUA_NATIVE_ROOT__.querySelector("#"+CSS.escape(String(id)));',
  );
  script = script.replace(/document\.getElementById\(([^)]*)\)/g, 'window.__LIANHUA_NATIVE_ROOT__.querySelector("#"+CSS.escape($1))');
  script = script.replace(/document\.querySelectorAll\(/g, "window.__LIANHUA_NATIVE_ROOT__.querySelectorAll(");
  script = script.replace(/document\.querySelector\(/g, "window.__LIANHUA_NATIVE_ROOT__.querySelector(");
  script = script.replace(/document\.documentElement/g, "window.__LIANHUA_NATIVE_ROOT__");
  script = script.replace(/document\.body/g, "window.__LIANHUA_NATIVE_ROOT__");

  script = script.replace(
    'function safeLocalGet(key,fallback=""){try{return localStorage.getItem(key)??fallback}catch(e){return fallback}}',
    'function safeLocalGet(key,fallback=""){try{return window.__LIANHUA_LOCAL_GET__(key)??fallback}catch(e){return fallback}}',
  );
  script = script.replace(
    'function safeLocalSet(key,value){try{localStorage.setItem(key,value);return true}catch(e){return false}}',
    'function safeLocalSet(key,value){try{return window.__LIANHUA_LOCAL_SET__(key,value)}catch(e){return false}}',
  );

  const loginStartIndex = script.indexOf("async function login(){");
  const loginClickMarker = '$("loginBtn").onclick=login;';
  const loginClickIndex = loginStartIndex >= 0 ? script.indexOf(loginClickMarker, loginStartIndex) : -1;
  if (loginStartIndex >= 0 && loginClickIndex > loginStartIndex) {
    const loginBlock = script.slice(loginStartIndex, loginClickIndex);
    const roleAssignment = "me={sid,roleCode,authorizedRoles:a?.roles||[]};";
    const assignmentIndex = loginBlock.indexOf(roleAssignment);
    if (assignmentIndex >= 0) {
      const commonTail = loginBlock.slice(assignmentIndex + roleAssignment.length).replace(/}\s*$/, "");
      const nativeLogin = `async function login(){
        const native=window.__LIANHUA_USER_CONTEXT__;
        let sid,code,roleCode,a;
        if(native?.studentNumber){
          sid=String(native.studentNumber).trim().toUpperCase();
          roleCode=String(native.roleCode||"").trim().toUpperCase();
          me={sid,roleCode,authorizedRoles:Array.isArray(native.authorizedRoles)?native.authorizedRoles:[]};
        }else{
          sid=$("loginSid").value.trim().toUpperCase();
          code=$("loginCode").value.trim();
          roleCode=$("loginRoleCode").value.trim().toUpperCase();
          a=ACCOUNTS[sid];
          if(!sid)return toast("请输入学号");
          if(!/^(?:[SY]\\d{7}|X\\d{6,8})$/.test(sid))return toast("请输入有效学号");
          if(!/^\\d{4}$/.test(code))return toast("请输入绑定手机号后四位");
          if(a&&a.code!==code)return toast("验证码不正确");
          if(roleCode&&!(a?.roles||[]).includes(roleCode))return toast("该学号未获授权使用此职务");
          me={sid,roleCode,authorizedRoles:a?.roles||[]};
        }
        ${commonTail}
      }`;
      script = script.slice(0, loginStartIndex) + nativeLogin + script.slice(loginClickIndex);
    }
  }


  script = script.replace(
    '<strong>陈诗情</strong>',
    '<strong>${esc(window.__LIANHUA_USER_CONTEXT__?.displayName || "校园用户")}</strong>',
  );
  script = script.replace(
    '$("loginBtn").onclick=login;',
    '$("loginBtn").onclick=login;if(window.__LIANHUA_USER_CONTEXT__?.studentNumber)void login();',
  );

  return script;
}

function createScriptCleanup(): {
  track: () => void;
  restore: () => void;
  cleanup: () => void;
} {
  const windowListeners: Array<{ type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }> = [];
  const documentListeners: Array<{ type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }> = [];
  const originalWindowAdd = window.addEventListener;
  const originalDocumentAdd = document.addEventListener;

  const track = () => {
    window.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      windowListeners.push({ type, listener, options });
      return originalWindowAdd.call(window, type, listener, options);
    } as typeof window.addEventListener;
    document.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      documentListeners.push({ type, listener, options });
      return originalDocumentAdd.call(document, type, listener, options);
    } as typeof document.addEventListener;
  };

  const restore = () => {
    window.addEventListener = originalWindowAdd;
    document.addEventListener = originalDocumentAdd;
  };

  const cleanup = () => {
    restore();
    for (const item of windowListeners) window.removeEventListener(item.type, item.listener, item.options);
    for (const item of documentListeners) document.removeEventListener(item.type, item.listener, item.options);
  };

  return { track, restore, cleanup };
}

function installAssetCss(css: string): string {
  const assets = {
    "assets/hero-veil.webp": getLianhuaPrivateAsset("assets/hero-veil.webp") ?? "",
    "assets/lianhua-lotus-tang.webp": getLianhuaPrivateAsset("assets/lianhua-lotus-tang.webp") ?? "",
    "assets/lianhua-comic.webp": getLianhuaPrivateAsset("assets/lianhua-comic.webp") ?? "",
  };

  let result = css;
  for (const [path, dataUrl] of Object.entries(assets)) {
    if (dataUrl) {
      result = result.replaceAll(`./${path}`, dataUrl).replaceAll(path, dataUrl);
    }
  }
  if (assets["assets/hero-veil.webp"]) {
    result = result.replaceAll("./assets/login-manga.webp", assets["assets/hero-veil.webp"]);
    result = result.replaceAll("assets/login-manga.webp", assets["assets/hero-veil.webp"]);
    result = result.replaceAll("./assets/login-paper.webp", assets["assets/hero-veil.webp"]);
    result = result.replaceAll("assets/login-paper.webp", assets["assets/hero-veil.webp"]);
  }
  return result;
}

function installBodyAssets(markup: string): string {
  const icon = getLianhuaPrivateAsset("icon.png");
  if (!icon) return markup;
  return markup.replace(/(\bsrc\s*=\s*["'])icon\.png(["'])/gi, (_match, before, after) => `${before}${icon}${after}`);
}

export function LianhuaApp({ visible, onNotice }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [, setError] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    const nativeWindow = window as LianhuaNativeWindow;
    const previous = {
      AiPhone: nativeWindow.AiPhone,
      root: nativeWindow.__LIANHUA_NATIVE_ROOT__,
      user: nativeWindow.__LIANHUA_USER_CONTEXT__,
      localGet: nativeWindow.__LIANHUA_LOCAL_GET__,
      localSet: nativeWindow.__LIANHUA_LOCAL_SET__,
    };

    root.innerHTML = '<div class="lianhua-loading">正在打开蓮華…</div>';

    const start = async () => {
      try {
        if (!isKvHydrated()) await hydrateKvDb();
        if (!isKvHydrated()) throw new Error("小手机本机数据库读取失败，请刷新后重试。");
        if (!isLianhuaPrivatePackageInstalled()) throw new Error("当前设备尚未安装蓮華 v0.5.27。请先到「设置 → 蓮華」导入 ZIP 安装包。");

        const html = getLianhuaPrivateHtml();
        if (!html) throw new Error("本机安装记录存在，但 index.html 缺失。请重新导入完整安装包。");
        if (disposed) return;
        const documentSource = new DOMParser().parseFromString(html, "text/html");
        const bodyMarkup = installBodyAssets(documentSource.body.innerHTML);
        const styleText = documentSource.querySelector("style")?.textContent ?? "";
        let scriptText = documentSource.querySelector("script")?.textContent ?? "";
        if (!bodyMarkup.trim() || !styleText.trim() || !scriptText.trim()) {
          throw new Error("蓮華安装包的页面结构不完整。请重新导入 v0.5.27 完整包。");
        }

        const userContext = await getNativeUserContext();
        if (disposed) return;
        const nativeApi = makeNativeApi(root);

        nativeWindow.__LIANHUA_NATIVE_ROOT__ = root;
        nativeWindow.__LIANHUA_USER_CONTEXT__ = userContext;
        nativeWindow.AiPhone = nativeApi;
        nativeWindow.__LIANHUA_LOCAL_GET__ = (key: string) => kvGet(`${PRIVATE_LOCAL_PREFIX}${key}`);
        nativeWindow.__LIANHUA_LOCAL_SET__ = (key: string, value: string) => {
          kvSet(`${PRIVATE_LOCAL_PREFIX}${key}`, String(value));
          return true;
        };

        root.innerHTML = bodyMarkup;
        const style = document.createElement("style");
        style.dataset.lianhuaStyle = "true";
        style.textContent = `${scopeStylesheet(installAssetCss(styleText))}
.lianhua-native-root{display:block;position:relative;width:100%;height:100%;min-height:0;overflow:hidden;background:#f7f4f9;color:#292333;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.lianhua-native-root .app{width:100%;max-width:760px;min-height:100%;height:100%;margin:0 auto;overflow:hidden}
.lianhua-native-root #mainApp,.lianhua-native-root #authGate{min-height:100%}
.lianhua-native-root .bottom{position:fixed;left:50%;transform:translateX(-50%);bottom:0;z-index:10}
.lianhua-native-root .lianhua-loading{padding:28px 18px;color:#76549d;text-align:center}
.lianhua-native-root .profile-id-card .profile-id-name img{max-width:44px;max-height:44px;object-fit:cover}
.lianhua-native-root .avatar img{width:100%;height:100%;object-fit:cover;border-radius:inherit}`;
        root.prepend(style);

        scriptText = patchForumScript(scriptText);
        const scriptCleanup = createScriptCleanup();
        scriptCleanup.track();
        try {
          const script = document.createElement("script");
          script.dataset.lianhuaRuntime = "true";
          script.text = scriptText;
          root.appendChild(script);
          script.remove();
        } finally {
          scriptCleanup.restore();
          // Remove only the forum's online/visibility listeners when this native pane unmounts.
          cleanupRef.current = scriptCleanup.cleanup;
        }

        if (disposed) {
          cleanupRef.current?.();
          cleanupRef.current = null;
          return;
        }
        setLoadState("ready");
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "蓮華启动失败。";
        if (!disposed) {
          setError(message);
          setLoadState("error");
          root.innerHTML = `<div class="lianhua-loading" role="alert">${message.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char))}</div>`;
        }
        onNotice?.(message);
      }
    };

    void start();

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      nativeWindow.AiPhone = previous.AiPhone;
      nativeWindow.__LIANHUA_NATIVE_ROOT__ = previous.root;
      nativeWindow.__LIANHUA_USER_CONTEXT__ = previous.user;
      nativeWindow.__LIANHUA_LOCAL_GET__ = previous.localGet;
      nativeWindow.__LIANHUA_LOCAL_SET__ = previous.localSet;
    };
  }, [onNotice]);

  return (
    <div
      ref={rootRef}
      className="lianhua-native-root phone-app-pane-inner"
      data-native-app="lianhua"
      data-load-state={loadState}
      data-visible={visible ? "true" : "false"}
      style={{
        display: visible ? "block" : "none",
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    />
  );
}
