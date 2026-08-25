import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
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
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        remarkPlugins={[remarkMath, remarkBasicAnswerSheetMarkdown]}
        skipHtml
      >
        {toStandardMathMarkdown(children)}
      </Markdown>
    </div>
  );
}
