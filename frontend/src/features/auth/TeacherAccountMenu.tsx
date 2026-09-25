import type { AuthIdentity } from "./authApi";

export function TeacherAccountMenu({ identity, onProfile }: {
  identity: AuthIdentity;
  onProfile: () => void;
}) {
  return <div className="teacher-account-menu">
    <button aria-label="打开个人中心" className="teacher-profile-link" onClick={onProfile} type="button">
      <span className="teacher-profile-initial" aria-hidden="true">{Array.from(identity.name.trim())[0] ?? "用"}</span>
      <span className="teacher-profile-label">个人中心</span>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
    </button>
  </div>;
}
