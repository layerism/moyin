import { useState } from "react";
import { UserAdminPage } from "../admin/UserAdminPage";
import type { AuthIdentity } from "./authApi";
import { PasswordChangeButton, PhoneSecurityPanel } from "./SmsPasswordRecovery";
import { ModelCardsAdminPage } from "../admin/ModelCardsAdminPage";
import { DatabaseAdminPage } from "../admin/DatabaseAdminPage";
import { TeacherInvitationsAdminPage } from "../admin/TeacherInvitationsAdminPage";

type Section = "personal" | "security" | "models" | "invitations" | "users" | "database";
type IconName = Section | "back" | "logout";
function ProfileIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    users: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2M20 4a4 4 0 0 1 0 8",
    personal: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2Z",
    security: "M7 2h10v20H7ZM10 18h4",
    models: "M6 6h12v12H6ZM9 9h6v6H9ZM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4",
    invitations: "M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM2 21v-2a8 8 0 0 1 12-7m4 1v8m-4-4h8",
    database: "M20 5c0 2-4 3-8 3S4 7 4 5s4-3 8-3 8 1 8 3ZM4 5v14c0 2 4 3 8 3s8-1 8-3V5M4 12c0 2 4 3 8 3s8-1 8-3",
    back: "M20 12H4m6-6-6 6 6 6",
    logout: "M10 3H3v18h7m5-14 5 5-5 5M8 12h12",
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function ProfilePage({ identity, onBack, onLogout, onPasswordChanged }: {
  identity: AuthIdentity;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onPasswordChanged: () => void;
}) {
  const [section, setSection] = useState<Section>("personal");
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const admin = identity.role === "super_admin";
  const roleName = admin ? "超级管理员" : "发布者";
  const items: { id: Section; label: string }[] = [
    { id: "personal", label: "个人资料" },
    { id: "security", label: "账户安全" },
    { id: "models", label: "我的模型配置" },
    ...(admin ? [{ id: "invitations" as const, label: "邀请管理" }, { id: "users" as const, label: "用户管理" }, { id: "database" as const, label: "数据库管理" }] : []),
  ];
  const logout = async () => {
    setLeaving(true); setError("");
    try { await onLogout(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "退出失败，请重试"); setLeaving(false); }
  };
  return <div className="profile-page">
    <aside className="profile-sidebar">
      <div className="profile-brand"><span className="oa-brand-mark">T</span><div><strong>材料收集</strong><small>个人中心</small></div></div>
      <nav aria-label="个人中心导航">{items.map(item => <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}><ProfileIcon name={item.id} />{item.label}</button>)}</nav>
      <div className="profile-sidebar-bottom"><button type="button" onClick={onBack}><ProfileIcon name="back" />返回工作台</button><button className="profile-logout" type="button" disabled={leaving} onClick={() => void logout()}><ProfileIcon name="logout" />{leaving ? "正在退出…" : "退出登录"}</button>{error && <p role="alert">{error}</p>}</div>
    </aside>
    <section className="profile-content" aria-label={items.find(item => item.id === section)?.label}>
      <header className="profile-banner"><div><p>账户中心</p><h1>{items.find(item => item.id === section)?.label}</h1><span>管理你的账户信息与安全设置</span></div><span className="profile-banner-badge">{roleName}</span></header>
      {section === "personal" && <div className="profile-overview">
        <article className="profile-card"><h2>基本信息</h2><div className="profile-identity"><span className="profile-avatar">{Array.from(identity.name)[0] ?? "用"}</span><div><strong>{identity.name}</strong><span className="profile-role">{roleName}</span></div></div><dl><div><dt>姓名</dt><dd>{identity.name}</dd></div><div><dt>账号</dt><dd>{identity.employeeNo ?? "—"}</dd></div><div><dt>角色</dt><dd>{roleName}</dd></div></dl></article>
        <article className="profile-card profile-security-summary"><span className="profile-security-icon"><ProfileIcon name="security" /></span><h2>安全手机号</h2><p>绑定手机号后，可通过短信验证找回密码。</p><button className="primary-action" type="button" onClick={() => setSection("security")}>查看安全设置</button></article>
      </div>}
      {section === "security" && <article className="profile-card profile-security-panel"><h2>账户安全</h2><section className="profile-security-setting"><h3>安全手机号</h3><PhoneSecurityPanel role="teacher" /></section><section className="profile-security-setting"><h3>登录密码</h3><p>通过已绑定手机号验证后修改密码。修改成功后，所有登录设备都会退出。</p><PasswordChangeButton role="teacher" onChanged={onPasswordChanged} /></section></article>}
      <div className="profile-embedded">
        {section === "users" && admin && <UserAdminPage />}
        {section === "models" && <ModelCardsAdminPage identity={identity} onBack={() => setSection("personal")} />}
        {section === "invitations" && admin && <TeacherInvitationsAdminPage identity={identity} onBack={() => setSection("personal")} />}
        {section === "database" && admin && <DatabaseAdminPage identity={identity} onBack={() => setSection("personal")} />}
      </div>
    </section>
  </div>;
}
