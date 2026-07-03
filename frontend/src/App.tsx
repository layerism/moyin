import { useMemo, useState } from "react";

import { FillView, SettingsView, StatsView } from "./features/collection/CollectionViews";
import { EditView } from "./features/editor/EditView";
import { AcademicFlowView, HomeView } from "./features/home/HomeView";
import { TopBar } from "./features/workspace/TopBar";
import { LoginView, PasswordChangeView, PasswordResetView } from "./features/auth/AuthViews";
import { initialAccounts, initialStudents } from "./data/mockData";
import type { DraftStudent, HomeFile, Screen, Student, StudentAccount, Tab } from "./types";
import { makeFileName } from "./utils/fileName";

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [tab, setTab] = useState<Tab>("edit");
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [accounts, setAccounts] = useState<StudentAccount[]>(initialAccounts);
  const [activeUser, setActiveUser] = useState<StudentAccount | null>(null);
  const [homeFolders, setHomeFolders] = useState<string[]>([]);
  const [homeActiveFolder, setHomeActiveFolder] = useState<string | null>(null);
  const [homeFiles, setHomeFiles] = useState<HomeFile[]>([]);
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
    setScreen("home");
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
        onAcademicFlow={() => setScreen("academicFlow")}
        onFilesChange={setHomeFiles}
        onFoldersChange={setHomeFolders}
        onLogin={() => setScreen("login")}
      />
    );
  }

  if (screen === "academicFlow") {
    return <AcademicFlowView onHome={() => setScreen("home")} />;
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
