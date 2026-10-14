"use client";

import { useState } from "react";
import type { ToolParameter } from "@/lib/ai/tool-catalog";
import { isUnconfiguredTool } from "@/lib/workflows/graph";
import type { FlowNode, FlowNodeData } from "@/lib/workflows/flow";
import {
  PLACEHOLDER,
  PREVIOUS_OUTPUT,
  coerce,
  isMultiline,
  toDraft,
} from "@/lib/workflows/argument-values";
import { InspectorPanel } from "./inspector-panel";
import { errorClass, fieldClass, hintClass, labelClass } from "./styles";
import { useServerTools } from "./use-tool-catalog";

/** Editor for a tool node: which tool it calls, and with what arguments. */
export function NodeInspector({
  node,
  serverName,
  onChange,
  onClose,
}: {
  node: FlowNode;
  serverName: string;
  onChange: (nodeId: string, patch: Partial<FlowNodeData>) => void;
  onClose: () => void;
}) {
  const catalog = useServerTools(node.data.serverSlug);
  const [filter, setFilter] = useState("");

  const toolSlug = isUnconfiguredTool(node.data.toolSlug) ? undefined : node.data.toolSlug;
  const tools = catalog.status === "ready" ? catalog.tools : [];
  const selected = tools.find((tool) => tool.toolSlug === toolSlug);

  const needle = filter.trim().toLowerCase();
  const matches = needle
    ? tools.filter(
        (tool) =>
          tool.toolSlug.toLowerCase().includes(needle) ||
          tool.description.toLowerCase().includes(needle),
      )
    : tools;

  function selectTool(nextToolSlug: string) {
    if (nextToolSlug === node.data.toolSlug) return;
    // Cleared, not carried over: the new tool may not accept the old arguments.
    onChange(node.id, {
      toolSlug: nextToolSlug,
      inputs: {},
      label: node.data.label === serverName ? nextToolSlug : node.data.label,
    });
  }

  return (
    <InspectorPanel
      eyebrow={serverName}
      title={toolSlug ?? "No tool selected"}
      monospaceTitle
      closeLabel="Close inspector"
      onClose={onClose}
    >
      <section>
        <p className={labelClass}>Tool</p>
        <input
          className={`${fieldClass} mt-1`}
          placeholder={catalog.status === "loading" ? "Loading tools..." : "Search tools"}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />

        {catalog.status === "error" ? (
          <p className={`mt-1 ${errorClass}`}>{catalog.error}</p>
        ) : null}

        {catalog.status === "ready" && tools.length === 0 ? (
          <p className={`mt-1 ${hintClass}`}>
            No tools available for {serverName}. Check the connection under
            Integrations.
          </p>
        ) : null}

        {tools.length > 0 ? (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#ebebeb] dark:border-[#1a1a1a]">
            {matches.length === 0 ? (
              <li className={`px-2 py-2 ${hintClass}`}>Nothing matches that.</li>
            ) : (
              matches.map((tool) => (
                <li key={tool.toolSlug}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] ${
                      tool.toolSlug === toolSlug ? "bg-[#f2f2f2] dark:bg-[#1a1a1a]" : ""
                    }`}
                    onClick={() => selectTool(tool.toolSlug)}
                  >
                    <span className="font-mono text-[11px] text-black dark:text-[#ededed]">
                      {tool.toolSlug}
                    </span>
                    {tool.description ? (
                      <span className={hintClass}>{tool.description.slice(0, 160)}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </section>

      {!toolSlug ? (
        <p className={`mt-4 ${hintClass}`}>Pick a tool to see the arguments it takes.</p>
      ) : (
        <section className="mt-4 border-t border-[#ebebeb] pt-3 dark:border-[#1a1a1a]">
          <p className={labelClass}>Arguments</p>
          {selected ? (
            <>
              {selected.description ? (
                <p className={`mt-1 ${hintClass}`}>{selected.description}</p>
              ) : null}
              <ArgumentForm
                key={toolSlug}
                schema={selected.schema}
                inputs={node.data.inputs ?? {}}
                onInputsChange={(inputs) => onChange(node.id, { inputs })}
              />
            </>
          ) : catalog.status === "ready" ? (
            <p className={`mt-2 ${errorClass}`}>
              {toolSlug} is not available on {serverName}. It may have been renamed,
              or the connection removed.
            </p>
          ) : null}
        </section>
      )}
    </InspectorPanel>
  );
}

function ArgumentForm({
  schema,
  inputs,
  onInputsChange,
}: {
  schema: ToolParameter[];
  inputs: Record<string, unknown>;
  onInputsChange: (inputs: Record<string, unknown>) => void;
}) {
  // Text as typed, which can run ahead of the committed value ("1." commits
  // as 1). Safe to keep locally: the canvas remounts when the graph is replaced.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.map((parameter) => [parameter.name, toDraft(inputs[parameter.name])])),
  );

  function commit(parameter: ToolParameter, text: string) {
    setDrafts((current) => ({ ...current, [parameter.name]: text }));
    const coerced = coerce(text, parameter.type);
    if (!coerced.ok) return;

    const next = { ...inputs };
    if (coerced.value === undefined) delete next[parameter.name];
    else next[parameter.name] = coerced.value;
    onInputsChange(next);
  }

  function removeExtra(key: string) {
    const next = { ...inputs };
    delete next[key];
    onInputsChange(next);
  }

  const known = new Set(schema.map((parameter) => parameter.name));
  const extras = Object.keys(inputs).filter((key) => !known.has(key));

  if (schema.length === 0 && extras.length === 0) {
    return <p className={`mt-2 ${hintClass}`}>This tool takes no arguments.</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      {schema.map((parameter) => {
        const draft = drafts[parameter.name] ?? "";
        const coerced = coerce(draft, parameter.type);
        const fieldId = `arg-${parameter.name}`;
        // A placeholder can stand in for any value, so it gets a text box.
        const choices = PLACEHOLDER.test(draft)
          ? undefined
          : (parameter.options ??
            (parameter.type === "boolean" ? ["true", "false"] : undefined));

        return (
          <div key={parameter.name}>
            <div className="flex items-baseline justify-between gap-2">
              <label className={`${labelClass} font-mono`} htmlFor={fieldId}>
                {parameter.name}
                {parameter.required ? (
                  <span className="ml-0.5 text-red-600 dark:text-red-400">*</span>
                ) : null}
              </label>
              <button
                type="button"
                title="Append a reference to the previous step's output"
                className="cursor-pointer text-[10px] text-[#666] hover:text-black dark:text-[#999] dark:hover:text-[#ededed]"
                onClick={() => commit(parameter, `${draft}${PREVIOUS_OUTPUT}`)}
              >
                + previous output
              </button>
            </div>

            {parameter.description ? (
              <p className={`mt-0.5 ${hintClass}`}>{parameter.description.slice(0, 200)}</p>
            ) : null}

            <div className="mt-1">
              {choices ? (
                <select
                  id={fieldId}
                  className={fieldClass}
                  value={draft}
                  onChange={(event) => commit(parameter, event.target.value)}
                >
                  <option value="">(unset)</option>
                  {choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : isMultiline(parameter) ? (
                <textarea
                  id={fieldId}
                  className={`${fieldClass} min-h-[72px] font-mono text-xs`}
                  value={draft}
                  onChange={(event) => commit(parameter, event.target.value)}
                />
              ) : (
                <input
                  id={fieldId}
                  className={fieldClass}
                  value={draft}
                  placeholder={parameter.type === "unknown" ? "" : parameter.type}
                  onChange={(event) => commit(parameter, event.target.value)}
                />
              )}
            </div>

            {!coerced.ok ? <p className={`mt-0.5 ${errorClass}`}>{coerced.error}</p> : null}
          </div>
        );
      })}

      {extras.length > 0 ? (
        <div className="border-t border-[#ebebeb] pt-2 dark:border-[#1a1a1a]">
          <p className={labelClass}>Not accepted by this tool</p>
          <p className={`mt-0.5 ${hintClass}`}>Saved on the node, but dropped when it runs.</p>
          <ul className="mt-1 flex flex-col gap-1">
            {extras.map((key) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-[#666] dark:text-[#999]">
                  {key}
                </span>
                <button
                  type="button"
                  className="cursor-pointer text-[10px] text-red-600 hover:underline dark:text-red-400"
                  onClick={() => removeExtra(key)}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={hintClass}>
        Reference an earlier step with{" "}
        <code className="font-mono">{PREVIOUS_OUTPUT}</code> or{" "}
        <code className="font-mono">{"{{steps.<id>.output}}"}</code>.
      </p>
    </div>
  );
}
