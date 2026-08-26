import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

import { toStandardMathMarkdown } from "./answerSheetMarkdown";
import { remarkBasicAnswerSheetMarkdown } from "./basicAnswerSheetMarkdown";

export function AnswerSheetMarkdown({
  children,
}: {
  children: string;
  flowId?: string;
  instanceId?: string;
}) {
  return (
    <div className="answer-sheet-markdown">
      <Markdown
        components={{
          table: ({ children }) => (
            <div className="answer-sheet-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        remarkPlugins={[remarkMath, remarkGfm, remarkBasicAnswerSheetMarkdown]}
        skipHtml
      >
        {toStandardMathMarkdown(children)}
      </Markdown>
    </div>
  );
}
