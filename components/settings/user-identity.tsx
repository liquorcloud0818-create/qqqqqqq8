"use client";

import { useState, useEffect, useCallback, useContext, useRef } from "react";
import { Plus, User, Trash2, FileEdit, AlertCircle, Camera, Link, X, Check } from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import { loadUserIdentities, saveUserIdentities } from "@/lib/settings-storage";
import { Input } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import {
    USER_PLATFORM_IDS,
    loadUserIdentityPlatformProfiles,
    saveUserIdentityPlatformProfiles,
    type UserPlatformId,
} from "@/lib/user-platform-profile-storage";
import {
    resolvePlatformAvatarAsset,
    savePlatformAvatarAsset,
} from "@/lib/platform-avatar-storage";

export type UserCampusIdentityProfile = {
    isTangdaStudent: boolean;
    nonStudentIdentityType?: "teacher" | "staff" | "alumni" | "external" | "other";
    studentNumber?: string;
    studentType?: "undergraduate" | "graduate";
    enrollmentYear?: string;
    departmentCode?: "01" | "02" | "03" | "04" | "05" | "06";
    phoneNumber?: string;
    hasStudentUnionIdentity?: boolean;
    studentUnionRole?: "chair" | "vice_chair" | "department_account" | "department_head" | "member";
    studentUnionDepartmentCode?: "01" | "02" | "03" | "04" | "05" | "06" | "07";
    studentUnionLoginCode?: string;
};

export type UserIdentity = {
    id: string;
    name: string;
    avatarUrl?: string;
    bio: string;
    gender: string;
    age: string;
    occupation: string;
    customSettings: string; // 熟悉信息，保留原字段以兼容旧身份
    closeSettings?: string;
    campusIdentity?: UserCampusIdentityProfile;
};

type UserPlatformDraftProfile = {
    nickname: string;
    avatarAssetId: string;
    avatarUrl: string;
};

type UserPlatformDraftState = {
    identityId: string;
    profiles: Record<UserPlatformId, UserPlatformDraftProfile>;
};

const USER_PLATFORM_ITEMS: Array<{ id: UserPlatformId; label: string }> = [
    { id: "chat", label: "Chat／朋友圈" },
    { id: "twitter", label: "X" },
    { id: "weibo", label: "微博" },
    { id: "douyin", label: "抖音" },
    { id: "xiaohongshu", label: "小红书" },
];

const CAMPUS_DEPARTMENTS = [
    { value: "01", label: "法学" },
    { value: "02", label: "经济学" },
    { value: "03", label: "文学" },
    { value: "04", label: "理学" },
    { value: "05", label: "工学" },
    { value: "06", label: "国际关系" },
] as const;

const STUDENT_UNION_DEPARTMENTS = [
    { value: "01", label: "办公室" },
    { value: "02", label: "宣传部" },
    { value: "03", label: "文艺部" },
    { value: "04", label: "体育部" },
    { value: "05", label: "生活权益部" },
    { value: "06", label: "外联部" },
    { value: "07", label: "社团管理部" },
] as const;

const DEFAULT_IDENTITIES: UserIdentity[] = [
    {
        id: "identity-1",
        name: "李斯特",
        bio: "一个普通的上班族，喜欢在周末去咖啡馆看书。",
        gender: "男",
        age: "26",
        occupation: "程序员",
        customSettings: "性格温和，说话带有一点理性逻辑。",
    },
    {
        id: "identity-2",
        name: "匿名用户",
        bio: "神秘的过客。",
        gender: "保密",
        age: "未知",
        occupation: "自由职业者",
        customSettings: "说话简短，带有神秘色彩。",
    }
];

function fileToDataUrl(file: File, maxSize = 400, quality = 0.8): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/webp", quality));
            };
            img.onerror = reject;
            img.src = reader.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function UserIdentitySettings() {
    const { setSubpageRightAction } = useContext(SettingsContext);
    const [identities, setIdentitiesRaw] = useState<UserIdentity[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewIdentity, setIsNewIdentity] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [platformDraft, setPlatformDraft] = useState<UserPlatformDraftState | null>(null);
    const platformDraftRef = useRef<UserPlatformDraftState | null>(null);
    const [platformProfileError, setPlatformProfileError] = useState("");
    const [platformProfileMessage, setPlatformProfileMessage] = useState("");
    const [uploadingPlatform, setUploadingPlatform] = useState<UserPlatformId | null>(null);
    const [isSavingPlatformDraft, setIsSavingPlatformDraft] = useState(false);

    const updatePlatformDraftProfile = useCallback((
        identityId: string,
        platformId: UserPlatformId,
        updates: Partial<UserPlatformDraftProfile>,
    ) => {
        const current = platformDraftRef.current;
        if (!current || current.identityId !== identityId) return;

        const next: UserPlatformDraftState = {
            ...current,
            profiles: {
                ...current.profiles,
                [platformId]: { ...current.profiles[platformId], ...updates },
            },
        };
        platformDraftRef.current = next;
        setPlatformDraft(next);
        setPlatformProfileError("");
        setPlatformProfileMessage("");
    }, []);

    const savePlatformDraft = useCallback((identityId: string) => {
        const current = platformDraftRef.current;
        if (!current || current.identityId !== identityId || uploadingPlatform !== null || isSavingPlatformDraft) return;

        setIsSavingPlatformDraft(true);
        setPlatformProfileError("");
        setPlatformProfileMessage("");
        try {
            saveUserIdentityPlatformProfiles(identityId, Object.fromEntries(
                USER_PLATFORM_IDS.map(id => [id, {
                    nickname: current.profiles[id].nickname,
                    avatarAssetId: current.profiles[id].avatarAssetId,
                }]),
            ));
            setPlatformProfileMessage("平台资料已保存");
        } catch {
            setPlatformProfileError("平台资料保存失败，请重试。");
        } finally {
            setIsSavingPlatformDraft(false);
        }
    }, [uploadingPlatform, isSavingPlatformDraft]);

    useEffect(() => {
        if (!editingId) {
            platformDraftRef.current = null;
            setPlatformDraft(null);
            setPlatformProfileError("");
            return;
        }

        let active = true;
        const saved = loadUserIdentityPlatformProfiles(editingId);
        const base: UserPlatformDraftState = {
            identityId: editingId,
            profiles: Object.fromEntries(USER_PLATFORM_IDS.map(id => [
                id,
                {
                    nickname: saved[id]?.nickname || "",
                    avatarAssetId: saved[id]?.avatarAssetId || "",
                    avatarUrl: "",
                },
            ])) as Record<UserPlatformId, UserPlatformDraftProfile>,
        };

        platformDraftRef.current = base;
        setPlatformDraft(base);
        setPlatformProfileError("");
        setPlatformProfileMessage("");

        void Promise.all(USER_PLATFORM_IDS.map(async id => {
            const assetId = saved[id]?.avatarAssetId || "";
            const avatarUrl = assetId ? await resolvePlatformAvatarAsset(assetId) : null;
            return { id, assetId, avatarUrl };
        })).then(resolved => {
            if (!active) return;
            const current = platformDraftRef.current;
            if (!current || current.identityId !== editingId) return;

            const nextProfiles = { ...current.profiles };
            for (const item of resolved) {
                if (nextProfiles[item.id].avatarAssetId === item.assetId) {
                    nextProfiles[item.id] = {
                        ...nextProfiles[item.id],
                        avatarUrl: item.avatarUrl || "",
                    };
                }
            }
            const next = { ...current, profiles: nextProfiles };
            platformDraftRef.current = next;
            setPlatformDraft(next);
        });

        return () => {
            active = false;
        };
    }, [editingId]);

    useEffect(() => {
        const saved = loadUserIdentities();
        if (saved.length > 0) {
            setIdentitiesRaw(saved);
        } else {
            setIdentitiesRaw(DEFAULT_IDENTITIES);
            saveUserIdentities(DEFAULT_IDENTITIES);
        }
    }, []);

    const setIdentities = useCallback((next: UserIdentity[]) => {
        setIdentitiesRaw(next);
        saveUserIdentities(next);
    }, []);

    const addIdentity = useCallback(() => {
        const newIdentity: UserIdentity = {
            id: `identity-${Date.now()}`,
            name: "新身份",
            bio: "",
            gender: "保密",
            age: "",
            occupation: "",
            customSettings: "",
            campusIdentity: {
                isTangdaStudent: false,
                nonStudentIdentityType: "other",
                hasStudentUnionIdentity: false,
            },
        };
        const next = [newIdentity, ...identities];
        setIdentities(next);
        setIsNewIdentity(true);
        setEditingId(newIdentity.id);
    }, [identities, setIdentities]);

    useEffect(() => {
        setSubpageRightAction("identity",
            <button
                onClick={addIdentity}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增身份</span>
            </button>
        );
        return () => setSubpageRightAction("identity", null);
    }, [addIdentity, setSubpageRightAction]);

    const updateIdentity = (id: string, updates: Partial<UserIdentity>) => {
        setIdentities(identities.map(i => i.id === id ? { ...i, ...updates } : i));
    };

    const updateCampusIdentity = (identity: UserIdentity, updates: Partial<UserCampusIdentityProfile>) => {
        const current = identity.campusIdentity ?? {
            isTangdaStudent: false,
            nonStudentIdentityType: "other" as const,
            hasStudentUnionIdentity: false,
        };
        const next: UserCampusIdentityProfile = { ...current, ...updates };
        if (!next.isTangdaStudent) {
            next.hasStudentUnionIdentity = false;
            delete next.studentNumber;
            delete next.studentType;
            delete next.enrollmentYear;
            delete next.departmentCode;
            delete next.phoneNumber;
            delete next.studentUnionRole;
            delete next.studentUnionDepartmentCode;
            delete next.studentUnionLoginCode;
        } else {
            delete next.nonStudentIdentityType;
            if (!next.hasStudentUnionIdentity) {
                delete next.studentUnionRole;
                delete next.studentUnionDepartmentCode;
                delete next.studentUnionLoginCode;
            }
        }
        updateIdentity(identity.id, { campusIdentity: next });
    };

    const removeIdentity = (id: string) => {
        const next = identities.filter(i => i.id !== id);
        setIdentities(next);
        if (editingId === id) {
            setEditingId(null);
            setIsNewIdentity(false);
        }
    };

    const selectClass = "ui-select";

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">User Identity</h2>
            </div>

            {identities.length === 0 ? (
                <div className="ui-empty">
                    <div className="ui-icon-circle">
                        <User size={24} />
                    </div>
                    <span className="menu-label font-semibold">没有身份卡片</span>
                    <span className="menu-desc max-w-[240px]">
                        在此管理您的个人身份信息，以便 AI 能够更好地了解您。
                    </span>
                    <button onClick={addIdentity} className="ui-btn ui-btn-primary rounded-[20px] mt-2">
                        <Plus size={16} /> 添加身份
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {identities.map(identity => (
                        <div
                            key={identity.id}
                            className="ui-config-card min-w-0 cursor-pointer overflow-hidden"
                            style={{ aspectRatio: "3 / 2", padding: "12px", justifyContent: "space-between" }}
                            role="button"
                            tabIndex={0}
                            aria-label={`编辑 ${identity.name || "身份"}`}
                            onClick={() => setEditingId(identity.id)}
                            onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setEditingId(identity.id);
                                }
                            }}
                        >
                            <div className="min-w-0 flex flex-col gap-1">
                                <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">{identity.name || "未命名身份"}</span>
                                <span className="menu-desc truncate">{identity.occupation || identity.bio || identity.gender || "未填写身份信息"}</span>
                            </div>
                            <div className="flex items-end justify-between gap-2">
                                {identity.avatarUrl ? (
                                    <img src={identity.avatarUrl} alt={identity.name} className="h-9 w-9 rounded-full object-cover shrink-0" />
                                ) : (
                                    <div className="h-9 w-9 rounded-full bg-[var(--c-page-body-bg)] text-[var(--c-icon)] grid place-items-center shrink-0">
                                        <User size={18} />
                                    </div>
                                )}

                                <div className="flex gap-2 shrink-0 items-center">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setEditingId(identity.id);
                                        }}
                                        className="ui-link-btn"
                                    >
                                        <FileEdit size={18} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setConfirmDeleteId(identity.id);
                                        }}
                                        className="ui-link-btn"
                                        data-variant="danger"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editingId && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet user-identity-dialog" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => { if (isNewIdentity && editingId) removeIdentity(editingId); setIsNewIdentity(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{isNewIdentity ? "添加身份" : "编辑身份"}</span>
                            <button onClick={() => { setIsNewIdentity(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>

                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            {(() => {
                                const identity = identities.find(c => c.id === editingId);
                                if (!identity) return null;
                                const campus = identity.campusIdentity ?? {
                                    isTangdaStudent: false,
                                    nonStudentIdentityType: "other" as const,
                                    hasStudentUnionIdentity: false,
                                };
                                return (
                                    <>
                                        {/* Avatar upload + URL */}
                                        <div className="flex flex-col items-center gap-2">
                                            <div
                                                onClick={() => {
                                                    const input = document.createElement("input");
                                                    input.type = "file";
                                                    input.accept = "image/*";
                                                    input.onchange = async () => {
                                                        const file = input.files?.[0];
                                                        if (!file) return;
                                                        try {
                                                            const dataUrl = await fileToDataUrl(file);
                                                            updateIdentity(identity.id, { avatarUrl: dataUrl });
                                                        } catch { /* ignore */ }
                                                    };
                                                    input.click();
                                                }}
                                                className="ui-avatar-upload"
                                            >
                                                {identity.avatarUrl ? (
                                                    <>
                                                        <img src={identity.avatarUrl} alt="" className="w-full h-full object-cover" />
                                                        <div className="absolute bottom-0 left-0 right-0 flex justify-center ui-avatar-upload-overlay">
                                                            <Camera size={14} color="#fff" />
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <User size={28} className="text-[var(--c-icon-active)]" />
                                                        <span className="ts-10 mt-[2px] text-[var(--c-icon-active)]">点击上传</span>
                                                    </>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-[6px] w-full max-w-[280px]">
                                                <Link size={14} className="shrink-0 text-[var(--c-text)]" />
                                                <Input
                                                    type="text"
                                                    value={identity.avatarUrl?.startsWith("data:") ? "" : (identity.avatarUrl || "")}
                                                    onChange={(e) => updateIdentity(identity.id, { avatarUrl: e.target.value })}
                                                    placeholder="或粘贴图片URL..."
                                                    className="flex-1 ts-12 px-[10px] py-[6px]"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex gap-3">
                                            <div className="flex flex-col gap-1 flex-1 min-w-0">
                                                <label className="menu-desc ml-1">名字 (Name)</label>
                                                <Input
                                                    type="text"
                                                    value={identity.name}
                                                    onChange={(e) => updateIdentity(identity.id, { name: e.target.value })}
                                                    placeholder="您希望AI怎么称呼您..."
                                                    className="font-medium"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1 w-[90px] shrink-0">
                                                <label className="menu-desc ml-1">性别</label>
                                                <select
                                                    value={identity.gender}
                                                    onChange={(e) => updateIdentity(identity.id, { gender: e.target.value })}
                                                    className="ui-select"
                                                >
                                                    <option value="保密">保密</option>
                                                    <option value="男">男</option>
                                                    <option value="女">女</option>
                                                    <option value="其他">其他</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex gap-3">
                                            <div className="flex flex-col gap-1 flex-1 min-w-0">
                                                <label className="menu-desc ml-1">年龄 (Age)</label>
                                                <input
                                                    type="text"
                                                    value={identity.age}
                                                    onChange={(e) => updateIdentity(identity.id, { age: e.target.value })}
                                                    placeholder="例如: 24, 未知"
                                                    className="ui-input"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1 flex-1 min-w-0">
                                                <label className="menu-desc ml-1">职业 (Occupation)</label>
                                                <input
                                                    type="text"
                                                    value={identity.occupation}
                                                    onChange={(e) => updateIdentity(identity.id, { occupation: e.target.value })}
                                                    placeholder="例如: 学生, 自由职业"
                                                    className="ui-input"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">基础设定</label>
                                            <textarea
                                                value={identity.bio}
                                                onChange={(e) => updateIdentity(identity.id, { bio: e.target.value })}
                                                placeholder="简单描述一下自己，这会作为AI了解您的基础背景..."
                                                rows={3}
                                                className="ui-textarea"
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">熟悉信息</label>
                                            <textarea
                                                value={identity.customSettings}
                                                onChange={(e) => updateIdentity(identity.id, { customSettings: e.target.value })}
                                                placeholder="熟悉的人知道的口味、爱好、生活习惯..."
                                                rows={4}
                                                className="ui-textarea"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">亲近信息</label>
                                            <textarea value={identity.closeSettings || ""} onChange={e => updateIdentity(identity.id, { closeSettings: e.target.value })} placeholder="亲近的人知道的近期动向、想法和计划..." rows={4} className="ui-textarea" />
                                        </div>

                                        <div className="mt-2 flex flex-col gap-3 border-t border-[var(--c-border)] pt-4">
                                            <div className="flex flex-col gap-1">
                                                <span className="menu-desc ml-1 font-semibold">棠大校园身份</span>
                                                <span className="ts-10 text-[var(--c-text-secondary)]">先确认是否为棠大学生；只有学生身份才会出现学籍和学生会资料。</span>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label className="menu-desc ml-1">是否为棠大学生</label>
                                                <select
                                                    value={campus.isTangdaStudent ? "yes" : "no"}
                                                    onChange={event => updateCampusIdentity(identity, {
                                                        isTangdaStudent: event.target.value === "yes",
                                                        nonStudentIdentityType: event.target.value === "yes" ? undefined : (campus.nonStudentIdentityType || "other"),
                                                        hasStudentUnionIdentity: false,
                                                    })}
                                                    className={selectClass}
                                                >
                                                    <option value="yes">是，棠大学生</option>
                                                    <option value="no">不是</option>
                                                </select>
                                            </div>

                                            {campus.isTangdaStudent ? (
                                                <>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="flex flex-col gap-1">
                                                            <label className="menu-desc ml-1">学籍类型</label>
                                                            <select
                                                                value={campus.studentType || "undergraduate"}
                                                                onChange={event => updateCampusIdentity(identity, { studentType: event.target.value as UserCampusIdentityProfile["studentType"] })}
                                                                className={selectClass}
                                                            >
                                                                <option value="undergraduate">本科生</option>
                                                                <option value="graduate">研究生</option>
                                                            </select>
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <label className="menu-desc ml-1">入学年份（后两位）</label>
                                                            <Input value={campus.enrollmentYear || ""} onChange={event => updateCampusIdentity(identity, { enrollmentYear: event.target.value.replace(/\D/g, "").slice(-2) })} placeholder="例如 24" maxLength={2} className="ts-12" />
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="flex flex-col gap-1">
                                                            <label className="menu-desc ml-1">院系</label>
                                                            <select
                                                                value={campus.departmentCode || ""}
                                                                onChange={event => updateCampusIdentity(identity, { departmentCode: (event.target.value || undefined) as UserCampusIdentityProfile["departmentCode"] })}
                                                                className={selectClass}
                                                            >
                                                                <option value="">选择院系</option>
                                                                {CAMPUS_DEPARTMENTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <label className="menu-desc ml-1">学号</label>
                                                            <Input value={campus.studentNumber || ""} onChange={event => updateCampusIdentity(identity, { studentNumber: event.target.value.trim().toUpperCase() })} placeholder="可填写已分配学号" className="ts-12" />
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <label className="menu-desc ml-1">校园手机号</label>
                                                        <Input value={campus.phoneNumber || ""} onChange={event => updateCampusIdentity(identity, { phoneNumber: event.target.value.replace(/[^\d+]/g, "") })} placeholder="填写校园身份绑定的手机号" className="ts-12" />
                                                    </div>

                                                    <div className="flex flex-col gap-1 border-t border-[var(--c-border)] pt-3">
                                                        <label className="menu-desc ml-1">是否有学生会身份</label>
                                                        <select
                                                            value={campus.hasStudentUnionIdentity ? "yes" : "no"}
                                                            onChange={event => updateCampusIdentity(identity, { hasStudentUnionIdentity: event.target.value === "yes" })}
                                                            className={selectClass}
                                                        >
                                                            <option value="no">没有学生会身份</option>
                                                            <option value="yes">有学生会身份</option>
                                                        </select>
                                                    </div>

                                                    {campus.hasStudentUnionIdentity ? (
                                                        <>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="flex flex-col gap-1">
                                                                    <label className="menu-desc ml-1">学生会职务</label>
                                                                    <select
                                                                        value={campus.studentUnionRole || ""}
                                                                        onChange={event => updateCampusIdentity(identity, { studentUnionRole: (event.target.value || undefined) as UserCampusIdentityProfile["studentUnionRole"] })}
                                                                        className={selectClass}
                                                                    >
                                                                        <option value="">选择职务</option>
                                                                        <option value="chair">主席</option>
                                                                        <option value="vice_chair">副主席</option>
                                                                        <option value="department_account">部门公共账号</option>
                                                                        <option value="department_head">部门部长</option>
                                                                        <option value="member">普通成员</option>
                                                                    </select>
                                                                </div>
                                                                <div className="flex flex-col gap-1">
                                                                    <label className="menu-desc ml-1">所属部门</label>
                                                                    <select
                                                                        value={campus.studentUnionDepartmentCode || ""}
                                                                        onChange={event => updateCampusIdentity(identity, { studentUnionDepartmentCode: (event.target.value || undefined) as UserCampusIdentityProfile["studentUnionDepartmentCode"] })}
                                                                        className={selectClass}
                                                                    >
                                                                        <option value="">选择部门</option>
                                                                        {STUDENT_UNION_DEPARTMENTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col gap-1">
                                                                <label className="menu-desc ml-1">学生会登录/权限代码</label>
                                                                <Input
                                                                    value={campus.studentUnionLoginCode || ""}
                                                                    onChange={event => updateCampusIdentity(identity, { studentUnionLoginCode: event.target.value.trim().toUpperCase() })}
                                                                    placeholder="仅填写已分配代码，如 S00、S0、D01"
                                                                    className="ts-12"
                                                                />
                                                            </div>
                                                        </>
                                                    ) : null}
                                                </>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <label className="menu-desc ml-1">非学生身份</label>
                                                    <select
                                                        value={campus.nonStudentIdentityType || "other"}
                                                        onChange={event => updateCampusIdentity(identity, { nonStudentIdentityType: event.target.value as UserCampusIdentityProfile["nonStudentIdentityType"] })}
                                                        className={selectClass}
                                                    >
                                                        <option value="teacher">教师</option>
                                                        <option value="staff">教职工</option>
                                                        <option value="alumni">校友</option>
                                                        <option value="external">校外人员</option>
                                                        <option value="other">其他</option>
                                                    </select>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-2 flex flex-col gap-3 border-t border-[var(--c-border)] pt-4">
                                            <div className="flex flex-col gap-1">
                                                <span className="menu-desc ml-1 font-semibold">平台资料</span>
                                                <span className="ts-10 text-[var(--c-text-secondary)]">此身份卡独立使用以下昵称和头像，不与其他 User 身份或角色档案共用。</span>
                                            </div>

                                            {platformDraft?.identityId === identity.id ? (
                                                <div className="flex flex-col gap-2">
                                                    {USER_PLATFORM_ITEMS.map(({ id, label }) => {
                                                        const profile = platformDraft.profiles[id];
                                                        return (
                                                            <div key={id} className="flex flex-col gap-2 rounded-2xl border border-[var(--c-border)] p-3">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-xs font-semibold text-[var(--c-text-title)]">{label}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const input = document.createElement("input");
                                                                            input.type = "file";
                                                                            input.accept = "image/*";
                                                                            input.onchange = () => {
                                                                                const file = input.files?.[0];
                                                                                if (!file) return;
                                                                                void (async () => {
                                                                                    setUploadingPlatform(id);
                                                                                    try {
                                                                                        setPlatformProfileError("");
                                                                                        const avatarAssetId = await savePlatformAvatarAsset(file);
                                                                                        const avatarUrl = await resolvePlatformAvatarAsset(avatarAssetId);
                                                                                        updatePlatformDraftProfile(identity.id, id, {
                                                                                            avatarAssetId,
                                                                                            avatarUrl: avatarUrl || "",
                                                                                        });
                                                                                    } catch (error) {
                                                                                        setPlatformProfileError(error instanceof Error ? error.message : "头像保存失败，请重试。");
                                                                                    } finally {
                                                                                        setUploadingPlatform(null);
                                                                                    }
                                                                                })();
                                                                            };
                                                                            input.click();
                                                                        }}
                                                                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--c-text)] hover:bg-[var(--c-page-body-bg)]"
                                                                    >
                                                                        <Camera size={13} />
                                                                        更换头像
                                                                    </button>
                                                                </div>

                                                                <div className="flex items-center gap-3">
                                                                    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--c-page-body-bg)]">
                                                                        {profile.avatarUrl ? (
                                                                            <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                                                                        ) : (
                                                                            <User size={18} className="text-[var(--c-icon)]" />
                                                                        )}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <label className="menu-desc ml-1">平台昵称</label>
                                                                        <Input
                                                                            type="text"
                                                                            value={profile.nickname}
                                                                            onChange={event => updatePlatformDraftProfile(identity.id, id, { nickname: event.target.value })}
                                                                            placeholder={`填写${label}昵称`}
                                                                            maxLength={48}
                                                                            className="ts-12"
                                                                        />
                                                                    </div>
                                                                </div>

                                                                {profile.avatarAssetId ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => updatePlatformDraftProfile(identity.id, id, { avatarAssetId: "", avatarUrl: "" })}
                                                                        className="self-end text-[11px] text-[var(--c-text-secondary)] hover:text-[var(--c-text)]"
                                                                    >
                                                                        移除平台头像
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <span className="menu-desc">正在读取此身份的平台资料…</span>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => savePlatformDraft(identity.id)}
                                                disabled={isSavingPlatformDraft || uploadingPlatform !== null}
                                                className="ui-btn ui-btn-primary mt-1 w-full justify-center disabled:opacity-50"
                                            >
                                                {isSavingPlatformDraft ? "正在保存…" : uploadingPlatform ? "正在上传头像…" : "保存平台资料"}
                                            </button>

                                            {platformProfileMessage ? (
                                                <span role="status" className="text-[11px] text-[var(--c-text-secondary)]">{platformProfileMessage}</span>
                                            ) : null}
                                            {platformProfileError ? (
                                                <span role="alert" className="text-[11px] text-red-500">{platformProfileError}</span>
                                            ) : null}
                                        </div>
                                    </>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除身份卡片后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeIdentity(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
}
