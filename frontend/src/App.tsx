import { useEffect, useMemo, useState } from "react";

import { AcademicFlowDesigner, StudentFlowPage } from "./features/academic-flow/AcademicFlowDesigner";
import { createAcademicProcess, createFallbackAcademicProcess } from "./features/academic-flow/academicFlowData";
import { workflowApi, type ServerFlow } from "./features/academic-flow/api";
import { StudentRuntimePage } from "./features/academic-flow/StudentRuntimePage";
import type { RuntimeFlowInstance } from "./features/academic-flow/runtimeTypes";
import { DatabaseAdminPage } from "./features/admin/DatabaseAdminPage";
import { TeacherInvitationsAdminPage } from "./features/admin/TeacherInvitationsAdminPage";
import { FillView, SettingsView, StatsView } from "./features/collection/CollectionViews";
import { EditView } from "./features/editor/EditView";
import { AcademicFlowView } from "./features/home/HomeView";
import { OssMaterialLibraryView } from "./features/home/OssMaterialLibraryView";
import { TopBar } from "./features/workspace/TopBar";
import { LoginView, PasswordChangeView, PasswordResetView } from "./features/auth/AuthViews";
import { AuthPortal, ForgotPasswordPlaceholder } from "./features/auth/AuthPortal";
import { StudentAccountPage } from "./features/auth/StudentAccountPage";
import { StudentAccessGate } from "./features/auth/StudentAccessGate";
import { StudentPasswordChangeForm } from "./features/auth/StudentPasswordChangeForm";
import { TeacherInvitationRegistrationPage } from "./features/auth/TeacherInvitationRegistrationPage";
import { authApi, type AuthIdentity, type AuthRole } from "./features/auth/authApi";
import { initialAccounts, initialStudents } from "./data/mockData";
import type {
  AcademicProcess,
  DraftStudent,
  Screen,
  Student,
  StudentAccount,
  Tab,
} from "./types";
import { makeFileName } from "./utils/fileName";

type AppRoute = {
  processId: string | null;
  screen: Screen;
  studentInstanceId: string | null;
  studentSlug: string | null;
  authRole: AuthRole;
  teacherInvitationToken: string | null;
};

function canonicalizeLegacyAuthPath() {
  const role = new URLSearchParams(window.location.search).get("role") === "teacher"
    ? "teacher"
    : "student";
  let target: string | null = null;
  if (window.location.pathname === "/auth/login") {
    target = role === "teacher" ? "/teacher/login" : "/login";
  } else if (window.location.pathname === "/auth/register") {
    target = role === "teacher"
      ? "/teacher/login?notice=invitation-required"
      : "/student/register";
  } else if (window.location.pathname === "/auth/forgot-password") {
    target = role === "teacher" ? "/teacher/forgot-password" : "/student/forgot-password";
  }
  if (target !== null) window.history.replaceState(null, "", target);
}

function getRouteFromPathname(): AppRoute {
  canonicalizeLegacyAuthPath();
  const pathname = window.location.pathname;
  const base = {
    processId: null,
    studentInstanceId: null,
    studentSlug: null,
    teacherInvitationToken: null,
  };
  if (pathname === "/login") {
    return { ...base, authRole: "student", screen: "authLogin" };
  }
  if (pathname === "/student/register") {
    return { ...base, authRole: "student", screen: "authRegister" };
  }
  if (pathname === "/teacher/login") {
    return { ...base, authRole: "teacher", screen: "authLogin" };
  }
  if (pathname === "/student/forgot-password") {
    return { ...base, authRole: "student", screen: "authForgot" };
  }
  if (pathname === "/teacher/forgot-password") {
    return { ...base, authRole: "teacher", screen: "authForgot" };
  }
  const teacherInvitationMatch = pathname.match(/^\/teacher\/invitations\/([^/]+)$/);
  if (teacherInvitationMatch) {
    return {
      ...base,
      authRole: "teacher",
      screen: "teacherInvitation",
      teacherInvitationToken: decodeURIComponent(teacherInvitationMatch[1]),
    };
  }
  if (pathname === "/student") {
    return { ...base, authRole: "student", screen: "studentHome" };
  }
  if (pathname === "/student/change-password") {
    return { ...base, authRole: "student", screen: "studentChangePassword" };
  }
  if (pathname === "/academic-flow") {
    return { ...base, authRole: "teacher", screen: "academicFlow" };
  }
  if (pathname === "/admin/database") {
    return { ...base, authRole: "teacher", screen: "adminDatabase" };
  }
  if (pathname === "/admin/teacher-invitations") {
    return { ...base, authRole: "teacher", screen: "teacherInvitationsAdmin" };
  }

  const sharedMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (sharedMatch) {
    return {
      ...base,
      authRole: "student",
      screen: "academicFlowShared",
      studentSlug: decodeURIComponent(sharedMatch[1]),
    };
  }

  const runtimeMatch = pathname.match(/^\/student\/flows\/([^/]+)$/);
  if (runtimeMatch) {
    return {
      ...base,
      authRole: "student",
      screen: "academicFlowStudentRuntime",
      studentInstanceId: decodeURIComponent(runtimeMatch[1]),
    };
  }

  const studentMatch = pathname.match(
    /^\/academic-flow\/([^/]+)\/student\/([^/]+)$/,
  );
  if (studentMatch) {
    return {
      ...base,
      processId: decodeURIComponent(studentMatch[1]),
      authRole: "student",
      screen: "academicFlowStudent",
      studentSlug: decodeURIComponent(studentMatch[2]),
    };
  }

  const detailMatch = pathname.match(/^\/academic-flow\/([^/]+)$/);
  if (detailMatch) {
    return {
      ...base,
      processId: decodeURIComponent(detailMatch[1]),
      authRole: "teacher",
      screen: "academicFlowDetail",
    };
  }

  return { ...base, authRole: "teacher", screen: "home" };
}

function pushAppPath(pathname: string) {
  if (`${window.location.pathname}${window.location.search}` !== pathname) {
    window.history.pushState(null, "", pathname);
  }
}

const STUDENT_AUTHENTICATED_SCREENS: Screen[] = [
  "academicFlowStudentRuntime",
  "studentChangePassword",
  "studentHome",
];

const TEACHER_AUTHENTICATED_SCREENS: Screen[] = [
  "academicFlow",
  "academicFlowDetail",
  "adminDatabase",
  "home",
  "teacherInvitationsAdmin",
  "workspace",
];

function mapServerFlow(flow: ServerFlow): AcademicProcess {
  return {
    answerSheetKeys: flow.answerSheetKeys ?? {},
    createdAt: new Date(flow.createdAt).toLocaleString("zh-CN"),
    description: flow.description,
    draftConfig: {
      edges: flow.draftConfig.edges ?? [],
      nodes: flow.draftConfig.nodes ?? [],
    },
    edges: flow.config.edges ?? [],
    encryptedSlug: "",
    hasUnpublishedChanges: flow.hasUnpublishedChanges,
    id: flow.id,
    name: flow.name,
    nodes: flow.config.nodes ?? [],
    published: flow.status === "published",
    publishedNodeIds: flow.publishedNodeIds,
    publishedVersionId: flow.publishedVersionId ?? undefined,
    publishedVersionNo: flow.publishedVersionNo ?? undefined,
    serverId: flow.id,
    shareUrl: flow.shareUrl,
  };
}

export function App() {
  const initialRoute = getRouteFromPathname();
  const [screen, setScreen] = useState<Screen>(initialRoute.screen);
  const [authRole, setAuthRole] = useState<AuthRole>(initialRoute.authRole);
  const [authReady, setAuthReady] = useState(false);
  const [teacherIdentity, setTeacherIdentity] = useState<AuthIdentity | null>(null);
  const [studentIdentity, setStudentIdentity] = useState<AuthIdentity | null>(null);
  const [tab, setTab] = useState<Tab>("edit");
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [accounts, setAccounts] = useState<StudentAccount[]>(initialAccounts);
  const [activeUser, setActiveUser] = useState<StudentAccount | null>(null);
  const [academicProcesses, setAcademicProcesses] = useState<AcademicProcess[]>([]);
  const [academicFlowsLoaded, setAcademicFlowsLoaded] = useState(false);
  const [academicFlowsLoadError, setAcademicFlowsLoadError] = useState("");
  const [activeAcademicProcessId, setActiveAcademicProcessId] = useState<string | null>(
    initialRoute.processId,
  );
  const [activeStudentToken, setActiveStudentToken] = useState<string | null>(
    initialRoute.studentSlug,
  );
  const [teacherInvitationToken, setTeacherInvitationToken] = useState<string | null>(
    initialRoute.teacherInvitationToken,
  );
  const [activeRuntimeInstanceId, setActiveRuntimeInstanceId] = useState<string | null>(
    initialRoute.studentInstanceId,
  );
  const [runtimeInstance, setRuntimeInstance] = useState<RuntimeFlowInstance | null>(null);
  const [collectionTitle, setCollectionTitle] = useState("密码学作业提交");
  const [fileNamePattern, setFileNamePattern] = useState("学号-姓名-材料名称.docx");
  const [deadline, setDeadline] = useState("2026-07-20 23:59");
  const [draftStudent, setDraftStudent] = useState<DraftStudent>({
    name: "",
    studentNo: "",
    className: "",
  });
  const [submitter, setSubmitter] = useState({ name: "李四", studentNo: "20240002" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("最近保存 12:28");

  useEffect(() => {
    const syncRoute = () => {
      const route = getRouteFromPathname();
      setActiveAcademicProcessId(route.processId);
      setActiveRuntimeInstanceId(route.studentInstanceId);
      setActiveStudentToken(route.studentSlug);
      setTeacherInvitationToken(route.teacherInvitationToken);
      setAuthRole(route.authRole);
      setScreen(route.screen);
    };

    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (screen === "home" && window.location.pathname === "/" && !teacherIdentity) {
      window.history.replaceState(null, "", "/login");
      setAuthRole("student");
      setScreen("authLogin");
      return;
    }
    if (TEACHER_AUTHENTICATED_SCREENS.includes(screen) && !teacherIdentity) {
      window.history.replaceState(null, "", "/teacher/login");
      setAuthRole("teacher");
      setScreen("authLogin");
      return;
    }
    const isRuntimePreview = screen === "academicFlowStudentRuntime"
      && new URLSearchParams(window.location.search).get("preview") === "1";
    if (
      STUDENT_AUTHENTICATED_SCREENS.includes(screen)
      && !isRuntimePreview
      && !studentIdentity
    ) {
      window.history.replaceState(null, "", "/login");
      setAuthRole("student");
      setScreen("authLogin");
    }
  }, [authReady, screen, studentIdentity, teacherIdentity]);

  useEffect(() => {
    if (!authReady || !studentIdentity) return;
    const isRuntimePreview = screen === "academicFlowStudentRuntime"
      && new URLSearchParams(window.location.search).get("preview") === "1";
    if (isRuntimePreview || !STUDENT_AUTHENTICATED_SCREENS.includes(screen)) return;
    if (studentIdentity.mustChangePassword && screen !== "studentChangePassword") {
      pushAppPath("/student/change-password");
      setScreen("studentChangePassword");
      return;
    }
    if (!studentIdentity.mustChangePassword && screen === "studentChangePassword") {
      pushAppPath("/student");
      setScreen("studentHome");
    }
  }, [authReady, screen, studentIdentity]);

  useEffect(() => {
    if (!teacherIdentity) {
      setAcademicProcesses([]);
      setAcademicFlowsLoaded(false);
      setAcademicFlowsLoadError("");
      return;
    }
    let cancelled = false;
    setAcademicProcesses([]);
    setAcademicFlowsLoaded(false);
    setAcademicFlowsLoadError("");
    workflowApi.listFlows()
      .then((flows) => {
        if (!cancelled) setAcademicProcesses(flows.map(mapServerFlow));
      })
      .catch((reason: Error) => {
        if (!cancelled) setAcademicFlowsLoadError(reason.message || "流程加载失败");
      })
      .finally(() => {
        if (!cancelled) setAcademicFlowsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherIdentity]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([authApi.me("teacher"), authApi.me("student")]).then(([teacher, student]) => {
      if (cancelled) return;
      if (teacher.status === "fulfilled") setTeacherIdentity(teacher.value);
      if (student.status === "fulfilled") setStudentIdentity(student.value);
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const submitted = students.filter((student) => student.submitStatus !== "未提交").length;
    const overwritten = students.filter((student) => student.submitStatus === "已覆盖").length;
    const temporary = students.filter((student) => student.source === "临时添加").length;
    const failed = students.filter((student) => student.checkStatus === "检查失败").length;
    return {
      total: students.length,
      submitted,
      overwritten,
      temporary,
      unsubmitted: students.length - submitted,
      failed,
    };
  }, [students]);

  const openWorkspace = (nextTab: Tab, user: StudentAccount | null = activeUser) => {
    setActiveUser(user);
    if (user) {
      setSubmitter({ name: user.name, studentNo: user.studentNo });
    }
    setTab(nextTab);
    setScreen("workspace");
  };

  const openHome = () => {
    pushAppPath("/");
    setActiveAcademicProcessId(null);
    setScreen("home");
  };

  const navigateAuth = (mode: "forgot" | "login" | "register", role: AuthRole) => {
    const pathname = role === "teacher"
      ? mode === "forgot" ? "/teacher/forgot-password" : "/teacher/login"
      : mode === "forgot" ? "/student/forgot-password"
        : mode === "register" ? "/student/register" : "/login";
    pushAppPath(pathname);
    setAuthRole(role);
    setScreen(mode === "forgot" ? "authForgot" : mode === "register" ? "authRegister" : "authLogin");
  };

  const completeAuthentication = (role: AuthRole, identity: AuthIdentity) => {
    if (role === "teacher") {
      setTeacherIdentity(identity);
      openAcademicFlow();
      return;
    }
    setStudentIdentity(identity);
    if (identity.mustChangePassword) {
      pushAppPath("/student/change-password");
      setScreen("studentChangePassword");
      return;
    }
    pushAppPath("/student");
    setScreen("studentHome");
  };

  const logoutRole = async (role: AuthRole) => {
    await authApi.logout(role);
    if (role === "teacher") setTeacherIdentity(null);
    else setStudentIdentity(null);
    navigateAuth("login", role);
  };

  const openAcademicFlow = () => {
    pushAppPath("/academic-flow");
    setActiveAcademicProcessId(null);
    setScreen("academicFlow");
  };

  const openDatabaseAdmin = () => {
    pushAppPath("/admin/database");
    setScreen("adminDatabase");
  };

  const openTeacherInvitationsAdmin = () => {
    pushAppPath("/admin/teacher-invitations");
    setScreen("teacherInvitationsAdmin");
  };

  const openAcademicProcess = (processId: string) => {
    pushAppPath(`/academic-flow/${encodeURIComponent(processId)}`);
    setActiveAcademicProcessId(processId);
    setScreen("academicFlowDetail");
  };

  const openStudentFlow = (shareUrl: string) => {
    pushAppPath(shareUrl);
    const pathParts = shareUrl.split("/").filter(Boolean);
    const token = pathParts[pathParts.length - 1] ?? null;
    setActiveStudentToken(token);
    setScreen("academicFlowShared");
  };

  const publishAcademicProcess = async (
    process: AcademicProcess,
    expectedDraftConfigHash?: string | null,
    expectedCurrentVersionId?: string | null,
  ) => {
    const serverId = process.serverId ?? (await workflowApi.createFlow(process)).id;
    const saved = { ...process, id: serverId, serverId };
    const published = await workflowApi.publish(
      serverId,
      saved,
      expectedDraftConfigHash,
      expectedCurrentVersionId,
    );
    return {
      ...saved,
      draftConfig: { nodes: saved.nodes, edges: saved.edges },
      encryptedSlug: published.token,
      hasUnpublishedChanges: false,
      published: true,
      publishedNodeIds: saved.nodes.map((node) => node.id),
      publishedVersionId: published.flowVersionId,
      publishedVersionNo: published.versionNo,
      shareUrl: published.shareUrl,
    };
  };

  const saveAcademicProcess = async (process: AcademicProcess) => {
    const serverId = process.serverId ?? process.id;
    return mapServerFlow(await workflowApi.saveDraft(serverId, process));
  };

  const updateAcademicProcess = (nextProcess: AcademicProcess) => {
    setAcademicProcesses((current) => {
      const exists = current.some((process) => process.id === nextProcess.id);
      if (!exists) {
        return [...current, nextProcess];
      }
      return current.map((process) => (process.id === nextProcess.id ? nextProcess : process));
    });
  };

  const addTemporaryStudent = () => {
    if (!draftStudent.name.trim() || !draftStudent.studentNo.trim()) {
      setNotice("请填写临时学生姓名和学号");
      return;
    }

    const exists = students.some((student) => student.studentNo === draftStudent.studentNo.trim());
    if (exists) {
      setNotice("该学号已在名单中");
      return;
    }

    const nextStudent: Student = {
      name: draftStudent.name.trim(),
      studentNo: draftStudent.studentNo.trim(),
      className: draftStudent.className.trim() || "临时",
      source: "临时添加",
      submitStatus: "未提交",
      checkStatus: "-",
      submitCount: 0,
    };

    setStudents((current) => [...current, nextStudent]);
    setAccounts((current) => [
      ...current,
      {
        name: nextStudent.name,
        studentNo: nextStudent.studentNo,
        password: `${nextStudent.studentNo.slice(-4)}Aa`,
      },
    ]);
    setDraftStudent({ name: "", studentNo: "", className: "" });
    setNotice("已临时添加学生");
  };

  const login = (name: string, studentNo: string, password: string) => {
    const account = accounts.find(
      (item) => item.name === name.trim() && item.studentNo === studentNo.trim(),
    );

    if (!account || account.password !== password) {
      setNotice("姓名、学号或密码不正确");
      return false;
    }

    setNotice(`${account.name} 已登录`);
    openWorkspace("fill", account);
    return true;
  };

  const resetPassword = (name: string, studentNo: string, password: string) => {
    const exists = accounts.some(
      (item) => item.name === name.trim() && item.studentNo === studentNo.trim(),
    );

    if (!exists) {
      setNotice("未找到匹配的学生账号");
      return false;
    }

    setAccounts((current) =>
      current.map((item) =>
        item.studentNo === studentNo.trim() ? { ...item, password } : item,
      ),
    );
    setNotice("密码已重置，请重新登录");
    setScreen("login");
    return true;
  };

  const changePassword = (
    name: string,
    studentNo: string,
    oldPassword: string,
    newPassword: string,
  ) => {
    const account = accounts.find(
      (item) => item.name === name.trim() && item.studentNo === studentNo.trim(),
    );

    if (!account || account.password !== oldPassword) {
      setNotice("原密码不正确");
      return false;
    }

    const nextAccount = { ...account, password: newPassword };
    setAccounts((current) =>
      current.map((item) => (item.studentNo === account.studentNo ? nextAccount : item)),
    );
    setActiveUser((current) =>
      current?.studentNo === account.studentNo ? nextAccount : current,
    );
    setNotice("密码已修改");
    openWorkspace("fill", nextAccount);
    return true;
  };

  const logout = () => {
    setActiveUser(null);
    setSelectedFile(null);
    openHome();
    setNotice("已退出登录");
  };

  const submitForm = () => {
    const matched = students.find(
      (student) => student.name === submitter.name && student.studentNo === submitter.studentNo,
    );

    if (!matched) {
      setNotice("姓名与学号不在学生名单中");
      return;
    }

    if (!selectedFile) {
      setNotice("请先上传 DOCX 材料");
      return;
    }

    const materialName = selectedFile.name.replace(/\.docx$/i, "") || "DOCX材料";
    const renamedFile = makeFileName(fileNamePattern, matched, materialName);

    setStudents((current) =>
      current.map((student) => {
        if (student.studentNo !== matched.studentNo) {
          return student;
        }

        const nextCount = student.submitCount + 1;
        return {
          ...student,
          submitStatus: nextCount > 1 ? "已覆盖" : "已提交",
          checkStatus: "检查中",
          fileName: renamedFile,
          submitCount: nextCount,
        };
      }),
    );
    setNotice(`已提交并自动命名：${renamedFile}`);
    setTab("stats");
  };

  if (screen === "authLogin" || screen === "authRegister") {
    return (
      <AuthPortal
        key={`${screen}-${authRole}`}
        mode={screen === "authRegister" ? "register" : "login"}
        notice={
          new URLSearchParams(window.location.search).get("notice") === "invitation-required"
            ? "教师账号需要通过超级管理员邀请链接注册"
            : ""
        }
        onAuthenticated={completeAuthentication}
        onNavigate={navigateAuth}
        role={authRole}
      />
    );
  }

  if (screen === "teacherInvitation" && teacherInvitationToken) {
    return (
      <TeacherInvitationRegistrationPage
        onAccepted={(identity) => completeAuthentication("teacher", identity)}
        onTeacherLogin={() => navigateAuth("login", "teacher")}
        token={teacherInvitationToken}
      />
    );
  }

  if (screen === "authForgot") {
    return (
      <ForgotPasswordPlaceholder
        role={authRole}
        onBack={() => navigateAuth("login", authRole)}
      />
    );
  }

  const isRuntimePreview = screen === "academicFlowStudentRuntime"
    && new URLSearchParams(window.location.search).get("preview") === "1";
  const requiresStudentIdentity = STUDENT_AUTHENTICATED_SCREENS.includes(screen)
    && !isRuntimePreview;
  if (!authReady && (TEACHER_AUTHENTICATED_SCREENS.includes(screen) || requiresStudentIdentity)) {
    return (
      <main className="auth-loading-page">
        <strong>正在验证登录状态</strong>
      </main>
    );
  }

  if (TEACHER_AUTHENTICATED_SCREENS.includes(screen) && !teacherIdentity) {
    return (
      <AuthPortal
        mode="login"
        onAuthenticated={completeAuthentication}
        onNavigate={navigateAuth}
        role="teacher"
      />
    );
  }

  if (requiresStudentIdentity && !studentIdentity) {
    return (
      <AuthPortal
        mode="login"
        onAuthenticated={completeAuthentication}
        onNavigate={navigateAuth}
        role="student"
      />
    );
  }

  if (
    requiresStudentIdentity
    && studentIdentity?.mustChangePassword
  ) {
    return (
      <main className="role-auth-page">
        <section className="role-auth-brand">
          <span className="oa-brand-mark">OA</span>
          <p>学生账户安全</p>
          <h1>首次登录请修改密码</h1>
          <div>完成改密后即可继续访问原有流程，已填写内容不会删除。</div>
        </section>
        <section className="role-auth-main">
          <StudentPasswordChangeForm
            identity={studentIdentity}
            onChanged={(identity) => {
              setStudentIdentity(identity);
              pushAppPath("/student");
              setScreen("studentHome");
            }}
            onLogout={() => logoutRole("student")}
          />
        </section>
      </main>
    );
  }

  if (screen === "studentChangePassword") {
    return <main className="auth-loading-page"><strong>正在进入学生中心</strong></main>;
  }

  if (screen === "adminDatabase") {
    return <DatabaseAdminPage identity={teacherIdentity!} onBack={openHome} />;
  }

  if (screen === "teacherInvitationsAdmin") {
    return <TeacherInvitationsAdminPage identity={teacherIdentity!} onBack={openHome} />;
  }

  if (screen === "studentHome") {
    if (!studentIdentity) {
      return (
        <AuthPortal
          mode="login"
          onAuthenticated={completeAuthentication}
          onNavigate={navigateAuth}
          role="student"
        />
      );
    }
    return (
      <StudentAccountPage
        identity={studentIdentity}
        onLogout={() => void logoutRole("student")}
        onOpenFlow={async (flowId) => {
          const instance = await workflowApi.enterFlow(flowId);
          setRuntimeInstance(instance);
          setActiveRuntimeInstanceId(instance.id);
          pushAppPath(`/student/flows/${encodeURIComponent(instance.id)}`);
          setScreen("academicFlowStudentRuntime");
        }}
      />
    );
  }

  if (screen === "home") {
    return (
      <OssMaterialLibraryView
        onAcademicFlow={openAcademicFlow}
        onDatabaseAdmin={openDatabaseAdmin}
        onTeacherLogout={() => void logoutRole("teacher")}
        onTeacherInvitations={openTeacherInvitationsAdmin}
        teacherIdentity={teacherIdentity!}
      />
    );
  }

  if (screen === "academicFlow") {
    return (
      <AcademicFlowView
        processes={academicProcesses}
        onDeleteProcess={async (process) => {
          await workflowApi.remove(process.serverId ?? process.id);
          setAcademicProcesses((current) => current.filter((item) => item.id !== process.id));
        }}
        onCreateProcess={async (name) => {
          const draft = createAcademicProcess(name);
          const created = await workflowApi.createFlow(draft);
          const process = { ...draft, id: created.id, serverId: created.id };
          setAcademicProcesses((current) => [process, ...current]);
        }}
        onCloneProcess={async (source, name) => {
          const cloned = mapServerFlow(
            await workflowApi.cloneFlow(source.serverId ?? source.id, name),
          );
          setAcademicProcesses((current) => [
            cloned,
            ...current.filter((process) => process.id !== cloned.id),
          ]);
          return cloned;
        }}
        onRenameProcess={async (process, name) => {
          const renamed = mapServerFlow(
            await workflowApi.renameFlow(process.serverId ?? process.id, name),
          );
          setAcademicProcesses((current) =>
            current.map((item) => (item.id === renamed.id ? renamed : item)),
          );
          return renamed;
        }}
        onDatabaseAdmin={openDatabaseAdmin}
        onOssCloud={openHome}
        onOpenProcess={openAcademicProcess}
        onTeacherLogout={() => void logoutRole("teacher")}
        onTeacherInvitations={openTeacherInvitationsAdmin}
        teacherIdentity={teacherIdentity!}
      />
    );
  }

  if (screen === "academicFlowDetail") {
    const activeProcess =
      academicProcesses.find((process) => process.id === activeAcademicProcessId) ?? null;

    if (!academicFlowsLoaded) {
      return <main className="auth-loading-page"><strong>正在加载流程</strong></main>;
    }

    if (!activeProcess) {
      return (
        <main className="auth-loading-page">
          <strong>{academicFlowsLoadError || "流程不存在或无权访问"}</strong>
        </main>
      );
    }

    return (
      <AcademicFlowDesigner
        process={activeProcess}
        onBack={openAcademicFlow}
        onOpenStudent={openStudentFlow}
        onPublishProcess={publishAcademicProcess}
        onProcessChange={updateAcademicProcess}
        onSaveProcess={saveAcademicProcess}
      />
    );
  }

  if (screen === "academicFlowStudent") {
    const activeProcess =
      academicProcesses.find((process) => process.id === activeAcademicProcessId) ??
      createFallbackAcademicProcess(activeAcademicProcessId ?? "academic-demo");

    return (
      <StudentFlowPage
        process={activeProcess}
        onBack={() => openAcademicProcess(activeProcess.id)}
      />
    );
  }

  if (screen === "academicFlowShared" && activeStudentToken) {
    return (
      <StudentAccessGate
        token={activeStudentToken}
        onEntered={(instance) => {
          void authApi.me("student").then(setStudentIdentity);
          setRuntimeInstance(instance);
          setActiveRuntimeInstanceId(instance.id);
          pushAppPath(`/student/flows/${encodeURIComponent(instance.id)}`);
          setScreen("academicFlowStudentRuntime");
        }}
      />
    );
  }

  if (screen === "academicFlowStudentRuntime" && activeRuntimeInstanceId) {
    return (
      <StudentRuntimePage
        initialInstance={runtimeInstance}
        instanceId={activeRuntimeInstanceId}
        preview={new URLSearchParams(window.location.search).get("preview") === "1"}
        onHome={() => {
          pushAppPath("/student");
          setScreen("studentHome");
        }}
      />
    );
  }

  if (screen === "login") {
    return (
      <LoginView
        notice={notice}
        onBack={() => setScreen("home")}
        onChangePassword={() => setScreen("changePassword")}
        onLogin={login}
        onReset={() => setScreen("reset")}
      />
    );
  }

  if (screen === "reset") {
    return (
      <PasswordResetView
        notice={notice}
        onBack={() => setScreen("login")}
        onResetPassword={resetPassword}
      />
    );
  }

  if (screen === "changePassword") {
    return (
      <PasswordChangeView
        activeUser={activeUser}
        notice={notice}
        onBack={() => setScreen(activeUser ? "workspace" : "login")}
        onChangePassword={changePassword}
      />
    );
  }

  return (
    <div className="workspace">
      <TopBar
        activeUser={activeUser}
        collectionTitle={collectionTitle}
        notice={notice}
        onChangePassword={() => setScreen("changePassword")}
        onHome={() => setScreen("home")}
        onLogout={logout}
      />
      <nav className="tabs" aria-label="工作区">
        <button className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
          编辑
        </button>
        <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
          统计
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          设置
        </button>
        <button className={tab === "fill" ? "active" : ""} onClick={() => setTab("fill")}>
          学生预览
        </button>
      </nav>

      {tab === "edit" && (
        <EditView collectionTitle={collectionTitle} onCollectionTitleChange={setCollectionTitle} />
      )}
      {tab === "stats" && <StatsView stats={stats} students={students} />}
      {tab === "settings" && (
        <SettingsView
          deadline={deadline}
          draftStudent={draftStudent}
          fileNamePattern={fileNamePattern}
          onAddStudent={addTemporaryStudent}
          onDeadlineChange={setDeadline}
          onDraftStudentChange={setDraftStudent}
          onFileNamePatternChange={setFileNamePattern}
          students={students}
        />
      )}
      {tab === "fill" && (
        <FillView
          activeUser={activeUser}
          fileNamePattern={fileNamePattern}
          onFileChange={setSelectedFile}
          onSubmit={submitForm}
          selectedFile={selectedFile}
          submitter={submitter}
          onSubmitterChange={setSubmitter}
        />
      )}
    </div>
  );
}
