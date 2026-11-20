export type CampusDepartmentCode = "01" | "02" | "03" | "04" | "05" | "06";
export type CampusStudentUnionDepartmentCode = "01" | "02" | "03" | "04" | "05" | "06" | "07";
export type CampusStudentUnionRole =
  | "chair"
  | "vice_chair"
  | "department_account"
  | "department_head"
  | "member";

/**
 * 校园身份资料。UserIdentity 与 Character 可共用该结构，
 * 资料只用于校园应用中的身份展示、校验与权限判断。
 */
export type CampusIdentityProfile = {
  /** 是否为棠大学生；未设置时表示尚未确认，不擅自推断。 */
  isTangdaStudent?: boolean;
  /** 非棠大学生的身份说明自由填写，不使用固定身份类别。 */
  nonStudentIdentity?: string;
  /** 是否具有校级学生会身份；普通学生不得自动获得该权限。 */
  hasStudentUnionIdentity?: boolean;
  /** 学号：本科生 S + 入学年份后两位 + 院系代码 + 三位序号；研究生以 Y 开头。 */
  studentNumber?: string;
  /** 学籍类型；用于区分本科生与研究生学号规则。 */
  studentType?: "undergraduate" | "graduate";
  /** 入学年份后两位。 */
  enrollmentYear?: string;
  /** 院系代码：01 法学、02 经济学、03 文学、04 理学、05 工学、06 国际关系。 */
  departmentCode?: CampusDepartmentCode;
  /** 校园系统手机号。 */
  phoneNumber?: string;
  /** 学生会身份；普通角色不设置此字段。 */
  studentUnionRole?: CampusStudentUnionRole;
  /** 学生会部门代码：01—07。 */
  studentUnionDepartmentCode?: CampusStudentUnionDepartmentCode;
  /** 学生会登录/权限代码，例如 S00、S0、D01—D07、D11—D17。 */
  studentUnionLoginCode?: string;
};

export type Character = {
  id: string;
  name: string;
  avatar: string | null; // data URL 或外部 URL
  persona: string;       // 人设
  briefPersona?: string; // 简量版人设：注入到同世界有关系角色的「角色关系」marker，供对方了解 TA（防 OOC）
  briefPersonaUpdatedAt?: string; // 简介生成时间；早于 updatedAt 时编辑器提示「设定已更新，建议重新生成」
  wechatID?: string;     // 手机号格式的微信号
  personality?: string;    // 角色性格
  nativeLanguage?: "persona" | "zh" | "ko" | "ja" | "en";
  communicationLanguage?: "persona" | "zh" | "ko" | "ja" | "en";
  languageUsage?: string;
  /** 中文输入按当前交流语言理解；未配置时默认开启。 */
  chineseProxyInput?: boolean;
  /** Legacy: info tier enum; non-enum relationship labels migrate into map lines. */
  userRelationship?: string;
  userKnowledgeLevels?: Record<string, "stranger" | "known" | "familiar" | "close">;
  userRelationshipLocked?: boolean;
  legacyUserRelationshipIdentityId?: string; // Frozen identity for old textual relationship migration
  timeZone?: string;       // IANA 时区，例如 America/New_York；空值表示跟随系统时间
  tags?: string[];
  createdAt: string;
  updatedAt: string;

  /** 校园身份资料；不设置时保持普通角色，不自动分配学号或学生会身份。 */
  campusIdentity?: CampusIdentityProfile;

  // 画布坐标与渲染属性
  canvasX?: number;
  canvasY?: number;
  canvasRot?: number;
  canvasZIndex?: number;
  polaroidStyle?: number; // 用户选择的拍立得样式索引
  polaroidSize?: "random" | "small" | "medium" | "large";
  polaroidImageX?: number;
  polaroidImageY?: number;
  polaroidImageZoom?: number;
};

export type CanvasBgItem = {
  id: string;
  type: 'a4' | 'yellow-note' | 'blue-note' | 'torn' | 'grid' | 'scrap';
  x: number;
  y: number;
  rot: number;
  zIndex: number;
  worldId?: string; // 所属世界画布；缺省 = 默认世界（存量数据零迁移）
};
