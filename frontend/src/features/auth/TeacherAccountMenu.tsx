import { useEffect, useRef, useState } from "react";

import type { AuthIdentity } from "./authApi";

export function TeacherAccountMenu({
  identity,
  onDatabaseAdmin,
  onLogout,
}: {
  identity: AuthIdentity;
  onDatabaseAdmin: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const initial = Array.from(identity.name.trim())[0] ?? "师";

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", closeOnOutside);
    return () => document.removeEventListener("click", closeOnOutside);
  }, [open]);

  return (
    <div className="teacher-account-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="查看教师账户信息"
        className="avatar"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {initial}
      </button>
      {open ? (
        <section className="teacher-account-popover" role="dialog" aria-label="教师账户信息">
          <header>
            <span>{initial}</span>
            <div>
              <strong>{identity.name}</strong>
              <small>{identity.role === "super_admin" ? "超级管理员" : "教师账户"}</small>
            </div>
          </header>
          <dl>
            <div><dt>姓名</dt><dd>{identity.name}</dd></div>
            <div><dt>工号</dt><dd>{identity.employeeNo ?? "-"}</dd></div>
            <div><dt>身份</dt><dd>{identity.role === "super_admin" ? "超级管理员" : "教师"}</dd></div>
          </dl>
          {identity.role === "super_admin" ? (
            <button className="teacher-account-admin" onClick={onDatabaseAdmin} type="button">
              数据库管理
            </button>
          ) : null}
          <button className="teacher-account-logout" onClick={onLogout} type="button">
            退出登录
          </button>
        </section>
      ) : null}
    </div>
  );
}
