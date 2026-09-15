import type { AuthIdentity } from "./authApi";

export function TeacherAccountMenu({ identity, onProfile }: {
  identity: AuthIdentity;
  onProfile: () => void;
}) {
  return <div className="teacher-account-menu">
    <button aria-label="打开个人中心" title="个人中心" className="avatar" onClick={onProfile} type="button">
      {Array.from(identity.name.trim())[0] ?? "用"}
    </button>
  </div>;
}
