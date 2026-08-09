import { useEffect, useMemo, useState } from "react";

import { AcademicFlowDesigner, StudentFlowPage } from "./features/academic-flow/AcademicFlowDesigner";
import { createAcademicProcess, createFallbackAcademicProcess } from "./features/academic-flow/academicFlowData";
import { workflowApi, type ServerFlow } from "./features/academic-flow/api";
import { StudentRuntimePage } from "./features/academic-flow/StudentRuntimePage";
import type { RuntimeFlowInstance } from "./features/academic-flow/runtimeTypes";
import { DatabaseAdminPage } from "./features/admin/DatabaseAdminPage";
import { FillView, SettingsView, StatsView } from "./features/collection/CollectionViews";
import { EditView } from "./features/editor/EditView";
import { AcademicFlowView, HomeView } from "./features/home/HomeView";
import { TopBar } from "./features/workspace/TopBar";
import { LoginView, PasswordChangeView, PasswordResetView } from "./features/auth/AuthViews";
import { AuthPortal, ForgotPasswordPlaceholder } from "./features/auth/AuthPortal";
import { StudentAccountPage } from "./features/auth/StudentAccountPage";
import { StudentAccessGate } from "./features/auth/StudentAccessGate";
import { authApi, type AuthIdentity, type AuthRole } from "./features/auth/authApi";
import { initialAccounts, initialStudents } from "./data/mockData";
import type {
  AcademicProcess,
  DraftStudent,
  HomeFile,
  Screen,
  Student,
  StudentAccount,
  Tab,
} from "./types";
import { makeFileName } from "./utils/fileName";

function getRouteFromPathname(): {
  processId: string | null;
  screen: Screen;
  studentInstanceId: string | null;
  studentSlug: string | null;
  authRole: AuthRole;
} {
  const authRole: AuthRole = new URLSearchParams(window.location.search).get("role") === "student"
    ? "student"
    : "teacher";
  if (window.location.pathname === "/auth/login") {
    return { authRole, processId: null, screen: "authLogin", studentInstanceId: null, studentSlug: null };
  }
  if (window.location.pathname === "/auth/register") {
    return { authRole, processId: null, screen: "authRegister", studentInstanceId: null, studentSlug: null };
  }
  if (window.location.pathname === "/auth/forgot-password") {
    return { authRole, processId: null, screen: "authForgot", studentInstanceId: null, studentSlug: null };
  }
  if (window.location.pathname === "/student") {
    return { authRole: "student", processId: null, screen: "studentHome", studentInstanceId: null, studentSlug: null };
  }
  if (window.location.pathname === "/academic-flow") {
    return { authRole, processId: null, screen: "academicFlow", studentInstanceId: null, studentSlug: null };
  }
  if (window.location.pathname === "/admin/database") {
    return { authRole, processId: null, screen: "adminDatabase", studentInstanceId: null, studentSlug: null };
  }

  const sharedMatch = window.location.pathname.match(/^\/s\/([^/]+)$/);
  if (sharedMatch) {
    return {
      processId: null,
      authRole: "student",
      screen: "academicFlowShared",
      studentInstanceId: null,
      studentSlug: decodeURIComponent(sharedMatch[1]),
    };
  }

  const runtimeMatch = window.location.pathname.match(/^\/student\/flows\/([^/]+)$/);
  if (runtimeMatch) {
    return {
      processId: null,
      authRole: "student",
      screen: "academicFlowStudentRuntime",
      studentInstanceId: decodeURIComponent(runtimeMatch[1]),
      studentSlug: null,
    };
  }

  const studentMatch = window.location.pathname.match(
    /^\/academic-flow\/([^/]+)\/student\/([^/]+)$/,
  );
  if (studentMatch) {
    return {
      processId: decodeURIComponent(studentMatch[1]),
      authRole: "student",
      screen: "academicFlowStudent",
      studentInstanceId: null,
      studentSlug: decodeURIComponent(studentMatch[2]),
    };
  }

  const detailMatch = window.location.pathname.match(/^\/academic-flow\/([^/]+)$/);
  if (detailMatch) {
    return {
      processId: decodeURIComponent(detailMatch[1]),
      authRole,
      screen: "academicFlowDetail",
      studentInstanceId: null,
      studentSlug: null,
    };
  }

  return { authRole, processId: null, screen: "home", studentInstanceId: null, studentSlug: null };
}

function pushAppPath(pathname: string) {
  if (window.location.pathname !== pathname) {
    window.history.pushState(null, "", pathname);
  }
}

function mapServerFlow(flow: ServerFlow): AcademicProcess {
  return {
    createdAt: new Date(flow.createdAt).toLocaleString("zh-CN"),
    description: flow.description,
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
  const [homeFolders, setHomeFolders] = useState<string[]>([]);
  const [homeActiveFolder, setHomeActiveFolder] = useState<string | null>(null);
  const [homeFiles, setHomeFiles] = useState<HomeFile[]>([]);
  const [academicProcesses, setAcademicProcesses] = useState<AcademicProcess[]>(() =>
    initialRoute.processId ? [createFallbackAcademicProcess(initialRoute.processId)] : [],
  );
  const [activeAcademicProcessId, setActiveAcademicProcessId] = useState<string | null>(
    initialRoute.processId,
  );
  const [activeStudentToken, setActiveStudentToken] = useState<string | null>(
    initialRoute.studentSlug,
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
      setAuthRole(route.authRole);
      setScreen(route.screen);
    };

    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (!teacherIdentity) return;
    workflowApi.listFlows().then((flows) => setAcademicProcesses(flows.map(mapServerFlow))).catch(() => undefined);
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
    const pathname = mode === "forgot" ? "/auth/forgot-password" : `/auth/${mode}`;
    pushAppPath(`${pathname}?role=${role}`);
    setAuthRole(role);
    setScreen(mode === "forgot" ? "authForgot" : mode === "register" ? "authRegister" : "authLogin");
  };

  const completeAuthentication = (role: AuthRole, identity: AuthIdentity) => {
    if (role === "teacher") {
      setTeacherIdentity(identity);
      openHome();
      return;
    }
    setStudentIdentity(identity);
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
      encryptedSlug: published.token,
      hasUnpublishedChanges: false,
      published: true,
      publishedNodeIds: saved.nodes.map((node) => node.id),
      publishedVersionId: published.flowVersionId,
      publishedVersionNo: published.versionNo,
      shareUrl: published.shareUrl,
    };
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
        initialRole={authRole}
        key={`${screen}-${authRole}`}
        mode={screen === "authRegister" ? "register" : "login"}
        onAuthenticated={completeAuthentication}
        onNavigate={navigateAuth}
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

  const teacherScreens: Screen[] = [
    "academicFlow",
    "academicFlowDetail",
    "adminDatabase",
    "home",
    "workspace",
  ];
  if (!authReady && (teacherScreens.includes(screen) || screen === "studentHome")) {
    return (
      <main className="auth-loading-page">
        <strong>正在验证登录状态</strong>
      </main>
    );
  }

  if (teacherScreens.includes(screen) && !teacherIdentity) {
    return (
      <AuthPortal
        initialRole="teacher"
        mode="login"
        onAuthenticated={completeAuthentication}
        onNavigate={navigateAuth}
      />
    );
  }

  if (screen === "adminDatabase") {
    return <DatabaseAdminPage identity={teacherIdentity!} onBack={openHome} />;
  }

  if (screen === "studentHome") {
    if (!studentIdentity) {
      return (
        <AuthPortal
          initialRole="student"
          mode="login"
          onAuthenticated={completeAuthentication}
          onNavigate={navigateAuth}
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
      <HomeView
        activeFolder={homeActiveFolder}
        files={homeFiles}
        folders={homeFolders}
        onAdminDemo={(nextTitle) => {
          setCollectionTitle(nextTitle || "未命名收集表");
          openWorkspace("edit", null);
        }}
        onActiveFolderChange={setHomeActiveFolder}
        onAcademicFlow={openAcademicFlow}
        onFilesChange={setHomeFiles}
        onFoldersChange={setHomeFolders}
        onLogin={() => navigateAuth("login", "student")}
        onDatabaseAdmin={openDatabaseAdmin}
        onTeacherLogout={() => void logoutRole("teacher")}
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
        onHome={openHome}
        onOssCloud={() => {
          setHomeActiveFolder(null);
          openHome();
        }}
        onOpenProcess={openAcademicProcess}
        onTeacherLogout={() => void logoutRole("teacher")}
        teacherIdentity={teacherIdentity!}
      />
    );
  }

  if (screen === "academicFlowDetail") {
    const activeProcess =
      academicProcesses.find((process) => process.id === activeAcademicProcessId) ?? null;

    if (!activeProcess) {
      return (
        <AcademicFlowDesigner
          process={createFallbackAcademicProcess(activeAcademicProcessId ?? "academic-demo")}
          onBack={openAcademicFlow}
          onHome={openHome}
          onOpenStudent={openStudentFlow}
          onPublishProcess={publishAcademicProcess}
          onProcessChange={updateAcademicProcess}
        />
      );
    }

    return (
      <AcademicFlowDesigner
        process={activeProcess}
        onBack={openAcademicFlow}
        onHome={openHome}
        onOpenStudent={openStudentFlow}
        onPublishProcess={publishAcademicProcess}
        onProcessChange={updateAcademicProcess}
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
        onHome={openHome}
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
