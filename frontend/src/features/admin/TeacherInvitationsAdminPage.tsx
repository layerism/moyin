import { useEffect, useState, type FormEvent } from "react";

import type { AuthIdentity } from "../auth/authApi";
import {
  teacherInvitationAdminApi,
  type CreatedTeacherInvitation,
  type TeacherInvitationRecord,
  type TeacherInvitationStatus,
} from "./teacherInvitationAdminApi";

const STATUS_LABELS: Record<TeacherInvitationStatus, string> = {
  active: "待注册",
  used: "已注册",
  expired: "已过期",
  revoked: "已撤销",
};

function defaultExpiry() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function TeacherInvitationsAdminPage({
  identity,
  onBack,
}: {
  identity: AuthIdentity;
  onBack: () => void;
}) {
  const [invitations, setInvitations] = useState<TeacherInvitationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedTeacherInvitation | null>(null);
  const [form, setForm] = useState({ employeeNo: "", expiresAt: defaultExpiry(), name: "" });
  const [formError, setFormError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<TeacherInvitationRecord | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setInvitations(await teacherInvitationAdminApi.list());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "教师邀请读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (identity.role !== "super_admin") {
    return (
      <main className="database-admin-denied">
        <h1>无权管理教师邀请</h1>
        <button onClick={onBack}>返回首页</button>
      </main>
    );
  }

  const openCreate = () => {
    setForm({ employeeNo: "", expiresAt: defaultExpiry(), name: "" });
    setFormError("");
    setCreated(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreated(null);
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!form.name.trim() || !/^\d{5}$/.test(form.employeeNo)) {
      setFormError("请填写教师姓名和 5 位数字工号");
      return;
    }
    const expiry = new Date(form.expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      setFormError("邀请有效期必须晚于当前时间");
      return;
    }
    setCreating(true);
    try {
      const result = await teacherInvitationAdminApi.create({
        employeeNo: form.employeeNo,
        expiresAt: expiry.toISOString(),
        name: form.name.trim(),
      });
      setCreated(result);
      setInvitations((current) => [
        result,
        ...current.filter((item) => item.id !== result.id),
      ]);
      setNotice("教师邀请已生成；链接关闭后将不再显示");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "教师邀请生成失败");
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setError("");
    try {
      const revoked = await teacherInvitationAdminApi.revoke(revokeTarget.id);
      setInvitations((current) => current.map((item) => item.id === revoked.id ? revoked : item));
      setNotice(`已撤销 ${revoked.name}（${revoked.employeeNo}）的教师邀请`);
      setRevokeTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "教师邀请撤销失败");
    } finally {
      setRevoking(false);
    }
  };

  const inviteUrl = created
    ? `${window.location.origin}/teacher/invitations/${created.token}`
    : "";

  return (
    <main className="teacher-invitations-admin-page">
      <header className="database-admin-header">
        <div>
          <span className="oa-brand-mark">TI</span>
          <div>
            <strong>教师邀请</strong>
            <small>超级管理员 · {identity.name}（{identity.employeeNo}）</small>
          </div>
        </div>
        <button onClick={onBack}>返回首页</button>
      </header>
      <section className="teacher-invitations-panel">
        <div className="teacher-invitations-toolbar">
          <div>
            <p>教师账号发放</p>
            <h1>一次性注册邀请</h1>
          </div>
          <button className="primary-action" onClick={openCreate}>+ 生成邀请</button>
        </div>
        {error ? <p className="database-admin-message error" role="alert">{error}</p> : null}
        {notice ? <p className="database-admin-message">{notice}</p> : null}
        <div className="teacher-invitations-table-wrap">
          <table className="teacher-invitations-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>工号</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>有效期至</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.name}</td>
                  <td>{invitation.employeeNo}</td>
                  <td>
                    <span className={`teacher-invitation-status ${invitation.status}`}>
                      {STATUS_LABELS[invitation.status]}
                    </span>
                  </td>
                  <td>{formatDate(invitation.createdAt)}</td>
                  <td>{formatDate(invitation.expiresAt)}</td>
                  <td>
                    {invitation.status === "active" ? (
                      <button className="teacher-invitation-revoke" onClick={() => setRevokeTarget(invitation)}>
                        撤销
                      </button>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && invitations.length === 0 ? (
            <p className="database-empty">尚未生成教师邀请</p>
          ) : null}
          {loading ? <p className="database-empty">正在读取教师邀请</p> : null}
        </div>
      </section>

      {createOpen ? (
        <div className="teacher-invitation-dialog-backdrop" role="presentation">
          <section aria-modal="true" className="teacher-invitation-dialog" role="dialog">
            <header>
              <div>
                <h2>{created ? "邀请链接已生成" : "生成教师邀请"}</h2>
                <p>{created ? "该链接仅在本次弹窗中显示，请立即复制。" : "姓名和工号将绑定到本次邀请。"}</p>
              </div>
              <button aria-label="关闭" onClick={closeCreate} type="button">×</button>
            </header>
            {created ? (
              <div className="teacher-invitation-result">
                <dl>
                  <div><dt>教师</dt><dd>{created.name}</dd></div>
                  <div><dt>工号</dt><dd>{created.employeeNo}</dd></div>
                  <div><dt>有效期至</dt><dd>{formatDate(created.expiresAt)}</dd></div>
                </dl>
                <label htmlFor="teacher-invitation-url">
                  <span>一次性注册链接</span>
                  <textarea id="teacher-invitation-url" readOnly rows={3} value={inviteUrl} />
                </label>
                <button
                  className="primary-action"
                  onClick={() => void navigator.clipboard.writeText(inviteUrl).then(
                    () => setNotice("教师邀请链接已复制"),
                    () => setFormError("复制失败，请手动复制链接"),
                  )}
                  type="button"
                >
                  复制邀请链接
                </button>
                {formError ? <p className="role-auth-error" role="alert">{formError}</p> : null}
              </div>
            ) : (
              <form onSubmit={submitCreate}>
                <label htmlFor="teacher-invitation-name">
                  <span>教师姓名</span>
                  <input
                    id="teacher-invitation-name"
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    required
                    value={form.name}
                  />
                </label>
                <label htmlFor="teacher-invitation-employee-no">
                  <span>工号</span>
                  <input
                    id="teacher-invitation-employee-no"
                    inputMode="numeric"
                    maxLength={5}
                    onChange={(event) => setForm({ ...form, employeeNo: event.target.value })}
                    pattern="[0-9]{5}"
                    placeholder="例如：04172"
                    required
                    value={form.employeeNo}
                  />
                </label>
                <label htmlFor="teacher-invitation-expiry">
                  <span>有效期至</span>
                  <input
                    id="teacher-invitation-expiry"
                    onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
                    required
                    type="datetime-local"
                    value={form.expiresAt}
                  />
                </label>
                <p className="role-auth-error" role="alert">{formError}</p>
                <footer>
                  <button onClick={closeCreate} type="button">取消</button>
                  <button className="primary-action" disabled={creating} type="submit">
                    {creating ? "正在生成" : "生成邀请"}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      ) : null}

      {revokeTarget ? (
        <div className="teacher-invitation-dialog-backdrop" role="presentation">
          <section aria-modal="true" className="teacher-invitation-dialog compact" role="alertdialog">
            <header>
              <div>
                <h2>撤销教师邀请</h2>
                <p>撤销后，该注册链接将立即失效。</p>
              </div>
            </header>
            <div className="teacher-invitation-revoke-copy">
              确认撤销 {revokeTarget.name}（{revokeTarget.employeeNo}）的邀请？
            </div>
            <footer>
              <button disabled={revoking} onClick={() => setRevokeTarget(null)}>取消</button>
              <button className="danger-action" disabled={revoking} onClick={() => void confirmRevoke()}>
                {revoking ? "正在撤销" : "确认撤销"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
