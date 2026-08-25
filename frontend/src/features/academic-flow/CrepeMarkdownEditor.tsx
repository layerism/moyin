import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { insert, replaceAll } from "@milkdown/kit/utils";
import "@milkdown/crepe/theme/classic.css";

import { workflowApi } from "./api";
import {
  findContentAssetIds,
  fromStandardMathMarkdown,
  replaceContentAssetUrls,
  restoreContentAssetReferences,
  toStandardMathMarkdown,
} from "./answerSheetMarkdown";

export default function CrepeMarkdownEditor({
  disabled,
  flowId,
  nodeKey,
  onChange,
  onUploadImage,
  value,
}: {
  disabled: boolean;
  flowId: string;
  nodeKey: string;
  onChange: (value: string) => void;
  onUploadImage: (file: File) => Promise<{ assetId: string; originalName: string }>;
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef(value);
  const assetUrlsRef = useRef(new Map<string, string>());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    const create = async () => {
      if (!rootRef.current) return;
      const markdown = await resolveAssets(value, flowId, assetUrlsRef.current);
      if (cancelled || !rootRef.current) return;
      const crepe = new Crepe({
        defaultValue: toStandardMathMarkdown(markdown),
        featureConfigs: {
          [Crepe.Feature.Latex]: {
            katexOptions: { strict: "warn", throwOnError: false, trust: false },
          },
          [Crepe.Feature.Placeholder]: {
            text: "输入 Markdown；行内公式使用 $$...$$，行间公式使用独占行的 $$$$...$$$$",
          },
        },
        features: { [Crepe.Feature.AI]: false },
        root: rootRef.current,
      });
      crepe.setReadonly(disabled);
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdownValue) => {
          const withReferences = restoreContentAssetReferences(
            markdownValue,
            assetUrlsRef.current,
          );
          const nextValue = fromStandardMathMarkdown(withReferences);
          lastEmittedRef.current = nextValue;
          onChangeRef.current(nextValue);
        });
      });
      editorRef.current = await crepe.create();
      crepeRef.current = crepe;
    };
    void create().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "编辑器加载失败");
    });
    return () => {
      cancelled = true;
      editorRef.current = null;
      const crepe = crepeRef.current;
      crepeRef.current = null;
      if (crepe) void crepe.destroy();
    };
  }, [flowId, nodeKey]);

  useEffect(() => {
    crepeRef.current?.setReadonly(disabled);
  }, [disabled]);

  useEffect(() => {
    if (!editorRef.current || value === lastEmittedRef.current) return;
    let cancelled = false;
    resolveAssets(value, flowId, assetUrlsRef.current).then((markdown) => {
      if (!cancelled && editorRef.current) {
        editorRef.current.action(replaceAll(toStandardMathMarkdown(markdown)));
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "题图读取失败");
    });
    return () => { cancelled = true; };
  }, [flowId, value]);

  const insertFormula = (display: boolean) => {
    if (!editorRef.current || disabled) return;
    editorRef.current.action(insert(display ? "\n\n$$\nx^2\n$$\n\n" : "$x^2$", !display));
  };

  const uploadImage = async (file: File) => {
    if (!editorRef.current || disabled) return;
    setUploading(true);
    setError("");
    try {
      const asset = await onUploadImage(file);
      const preview = await workflowApi.getTeacherAnswerSheetAsset(flowId, asset.assetId);
      assetUrlsRef.current.set(asset.assetId, preview.url);
      editorRef.current.action(insert(`\n\n![${escapeLabel(asset.originalName)}](${preview.url})\n\n`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "题图上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleCustomMathInput = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      disabled
      || !editorRef.current
      || !event.target
      || !(event.target as HTMLElement).closest(".crepe-markdown-root")
    ) return;
    if (event.key !== "$" && event.key !== "Enter") return;
    editorRef.current.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { $from, empty, from } = state.selection;
      if (!empty || !$from.parent.isTextblock) return;
      if (event.key === "Enter" && $from.parent.textContent === "$$$$") {
        const codeBlock = state.schema.nodes.code_block;
        if (!codeBlock) return;
        event.preventDefault();
        const start = $from.start();
        view.dispatch(
          state.tr
            .delete(start, from)
            .setBlockType(start, start, codeBlock, { language: "LaTeX" }),
        );
        return;
      }
      if (event.key !== "$") return;
      event.preventDefault();
      const before = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
      const match = `${before}$`.match(/\$\$([^$\n]+)\$\$$/);
      let transaction = state.tr.insertText("$");
      if (match?.index !== undefined) {
        const mathNode = state.schema.nodes.math_inline;
        if (mathNode) {
          transaction = transaction.replaceWith(
            $from.start() + match.index,
            from + 1,
            mathNode.create({ value: match[1] }),
          );
        }
      }
      view.dispatch(transaction);
    });
  };

  return (
    <div
      className={`crepe-markdown-editor${disabled ? " is-disabled" : ""}`}
      onKeyDownCapture={handleCustomMathInput}
    >
      <div className="crepe-markdown-toolbar">
        <button disabled={disabled} onClick={() => insertFormula(false)} type="button">行内公式</button>
        <button disabled={disabled} onClick={() => insertFormula(true)} type="button">行间公式</button>
        <label className={disabled || uploading ? "is-disabled" : ""}>
          {uploading ? "上传中…" : "插入图片"}
          <input
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || uploading}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void uploadImage(file);
            }}
          />
        </label>
      </div>
      {error ? <p className="answer-sheet-editor-error" role="alert">{error}</p> : null}
      <div className="crepe-markdown-root" ref={rootRef} />
    </div>
  );
}

async function resolveAssets(
  source: string,
  flowId: string,
  cache: Map<string, string>,
): Promise<string> {
  await Promise.all(findContentAssetIds(source).map(async (assetId) => {
    if (cache.has(assetId)) return;
    const asset = await workflowApi.getTeacherAnswerSheetAsset(flowId, assetId);
    cache.set(assetId, asset.url);
  }));
  return replaceContentAssetUrls(source, cache);
}

function escapeLabel(value: string): string {
  return value.replace(/[\[\]]/g, "");
}
