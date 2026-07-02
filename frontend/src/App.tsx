const modules = [
  "教师上传 Word 模板",
  "自动提取空项与选项",
  "学生登录并填写表单",
  "生成并下载 Word 文档",
  "AI 辅助填写与模板识别",
];

export function App() {
  return (
    <main className="app-shell">
      <section className="intro">
        <h1>文档自动填写系统</h1>
        <p>当前为项目初始化骨架，后续将分阶段实现模板解析、学生填写、文档生成与 AI 辅助能力。</p>
      </section>

      <section className="module-list" aria-label="系统模块">
        {modules.map((module) => (
          <article className="module-card" key={module}>
            <span>{module}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
