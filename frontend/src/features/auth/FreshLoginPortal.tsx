import { useEffect, useState, type ComponentProps } from "react";

import { AuthPortal } from "./AuthPortal";
import { authApi, type AuthRole } from "./authApi";

type Props = Omit<ComponentProps<typeof AuthPortal>, "mode"> & {
  onSessionCleared: (role: AuthRole) => void;
};

// The parent keys this component by role so each login-page visit starts empty.
export function FreshLoginPortal({ onSessionCleared, ...props }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    onSessionCleared(props.role);
    void authApi.logout(props.role).then(() => {
      if (!cancelled) setReady(true);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "无法退出旧会话");
    });
    return () => { cancelled = true; };
  }, [attempt, onSessionCleared, props.role]);

  if (!ready) {
    return <main className="auth-loading-page">
      {error ? <div role="alert">
        <p>暂时无法准备登录，请重试：{error}</p>
        <button className="primary-action" onClick={() => setAttempt((current) => current + 1)} type="button">重试</button>
      </div> : <strong>正在准备登录…</strong>}
    </main>;
  }

  return <AuthPortal {...props} mode="login" />;
}
