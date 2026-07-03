import type { StudentAccount } from "../../types";

export function TopBar({
  activeUser,
  collectionTitle,
  notice,
  onChangePassword,
  onHome,
  onLogout,
}: {
  activeUser: StudentAccount | null;
  collectionTitle: string;
  notice: string;
  onChangePassword: () => void;
  onHome: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="home-dot" />
        <button
          aria-label="返回首页"
          className="chrome-button"
          onClick={onHome}
          title="返回首页"
        >
          ⌂
        </button>
        <button className="chrome-button">+</button>
        <h1>{collectionTitle || "未命名收集表"}</h1>
        <span className="star">☆</span>
        <span className="folder">□</span>
        <span className="save-state">○ {notice}</span>
      </div>
      <div className="topbar-right">
        {activeUser && <span className="save-state">{activeUser.name}</span>}
        {activeUser && (
          <button className="topbar-text-button" onClick={onChangePassword}>
            改密
          </button>
        )}
        <button className="topbar-text-button" onClick={onLogout}>
          退出
        </button>
        <button className="chrome-button">☰</button>
        <button className="avatar">{activeUser?.name.slice(0, 1) ?? "卢"}</button>
      </div>
    </header>
  );
}
