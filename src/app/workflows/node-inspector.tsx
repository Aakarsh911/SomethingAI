"use client";

import { useMemo, useState } from "react";
import type { ToolParameter } from "@/lib/ai/tool-catalog";
import { isUnconfiguredTool } from "@/lib/workflows/graph";
import type { FlowNode, FlowNodeData } from "@/lib/workflows/flow";
import {
  PLACEHOLDER,
  PREVIOUS_OUTPUT,
  coerce,
  isMultiline,
  isSettled,
  toDraft,
} from "@/lib/workflows/argument-values";
import { useToolCatalog, useToolSchema } from "./use-tool-catalog";

/**
 * Editor for the selected node: which tool it calls, and with what arguments.
 *
 * Until this existed the canvas could place a node naming a server but never
 * say which of that server's hundred tools to call, or what to pass it —
 * those could only be written by the model through the chat. A node added by
 * hand carried a placeholder slug that saved cleanly and failed at run time.
 */

const fieldClass =
  "w-full rounded-lg border border-[#ebebeb] bg-transparent px-2 py-1.5 text-sm text-black outline-none focus:border-neutral-400 dark:border-[#1a1a1a] dark:text-[#ededed] dark:focus:border-[#444]";

const labelClass = "text-xs font-medium text-black dark:text-[#ededed]";
const hintClass = "text-[11px] leading-snug text-[#666] dark:text-[#999]";

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
  const { servers, loading: catalogLoading, error: catalogError } = useToolCatalog();
  const serverSlug = node.data.serverSlug;
  const toolSlug = isUnconfiguredTool(node.data.toolSlug)
    ? undefined
    : node.data.toolSlug;

  const {
    schema,
    description,
    loading: schemaLoading,
    error: schemaError,
  } = useToolSchema(serverSlug, toolSlug);

  const [filter, setFilter] = useState("");

  const tools = useMemo(
    () => servers.find((server) => server.serverSlug === serverSlug)?.tools ?? [],
    [servers, serverSlug],
  );

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (tool) =>
        tool.toolSlug.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle),
    );
  }, [filter, tools]);

  function selectTool(nextToolSlug: string) {
    if (nextToolSlug === node.data.toolSlug) return;

    // Arguments are cleared rather than carried over. Two tools sharing an
    // argument name is the exception, and a silently retained value for a
    // field the new tool does not accept is dropped at call time with nothing
    // here to explain why.
    onChange(node.id, {
      toolSlug: nextToolSlug,
      inputs: {},
      label: node.data.label === serverName ? nextToolSlug : node.data.label,
    });
  }

  return (
    <aside className="absolute top-0 right-0 z-30 flex h-full w-80 flex-col border-l border-[#ebebeb] bg-white dark:border-[#1a1a1a] dark:bg-neutral-950">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[#ebebeb] px-3 py-2 dark:border-[#1a1a1a]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide text-[#666] uppercase dark:text-[#999]">
            {serverName}
          </p>
          <p className="truncate font-mono text-xs text-black dark:text-[#ededed]">
            {toolSlug ?? "No tool selected"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close inspector"
          className="cursor-pointer rounded px-1 text-sm text-[#666] hover:text-black dark:hover:text-[#ededed]"
          onClick={onClose}
        >
          &times;
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <section>
          <p className={labelClass}>Tool</p>
          <input
            className={`${fieldClass} mt-1`}
            placeholder={catalogLoading ? "Loading tools..." : "Search tools"}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />

          {catalogError ? (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              {catalogError}
            </p>
          ) : null}

          {!catalogLoading && !catalogError && tools.length === 0 ? (
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
                matches.map((tool) => {
                  const active = tool.toolSlug === toolSlug;
                  return (
                    <li key={tool.toolSlug}>
                      <button
                        type="button"
                        className={`flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] ${
                          active ? "bg-[#f2f2f2] dark:bg-[#1a1a1a]" : ""
                        }`}
                        onClick={() => selectTool(tool.toolSlug)}
                      >
                        <span className="font-mono text-[11px] text-black dark:text-[#ededed]">
                          {tool.toolSlug}
                        </span>
                        {tool.description ? (
                          <span className={hintClass}>{tool.description}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </section>

        {toolSlug ? (
          <section className="mt-4 border-t border-[#ebebeb] pt-3 dark:border-[#1a1a1a]">
            <p className={labelClass}>Arguments</p>
            {description ? <p className={`mt-1 ${hintClass}`}>{description}</p> : null}

            {schemaLoading ? (
              <p className={`mt-2 ${hintClass}`}>Loading arguments...</p>
            ) : null}

            {schemaError ? (
              <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                {schemaError}
              </p>
            ) : null}

            {schema ? (
              <ArgumentForm
                key={`${node.id}:${toolSlug}`}
                schema={schema}
                inputs={node.data.inputs ?? {}}
                onInputsChange={(inputs) => onChange(node.id, { inputs })}
              />
            ) : null}
          </section>
        ) : (
          <p className={`mt-4 ${hintClass}`}>
            Pick a tool to see the arguments it takes.
          </p>
        )}
      </div>
    </aside>
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
  // What a box shows is normally derived from the committed value, so a graph
  // rewritten underneath an open inspector — which /modify does — appears
  // immediately. `unsettled` holds text only for the fields where that
  // derivation would fight the typing: "1." in a number box coerces to 1 and
  // would render back as "1", eating the character as it is typed, and "{" in
  // a JSON box does not coerce at all.
  const [unsettled, setUnsettled] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function draftFor(parameter: ToolParameter): string {
    return unsettled[parameter.name] ?? toDraft(inputs[parameter.name]);
  }

  function commit(parameter: ToolParameter, text: string) {
    const coerced = coerce(text, parameter.type);

    setUnsettled((current) => {
      const next = { ...current };
      // Settled means the committed value renders back as exactly this text,
      // so the field can stop shadowing the graph and go back to deriving.
      if (isSettled(text, parameter.type)) delete next[parameter.name];
      else next[parameter.name] = text;
      return next;
    });

    setErrors((current) => {
      const next = { ...current };
      if (coerced.ok) delete next[parameter.name];
      else next[parameter.name] = coerced.error;
      return next;
    });

    if (!coerced.ok) return;

    const next = { ...inputs };
    // A blank argument is removed rather than sent as "", because an empty
    // string is a meaningful value to some tools and "unset" is what a blank
    // box means.
    if (coerced.value === undefined) delete next[parameter.name];
    else next[parameter.name] = coerced.value;

    onInputsChange(next);
  }

  const known = new Set(schema.map((parameter) => parameter.name));
  const extras = Object.keys(inputs).filter((key) => !known.has(key));

  function removeExtra(key: string) {
    const next = { ...inputs };
    delete next[key];
    onInputsChange(next);
  }

  if (schema.length === 0 && extras.length === 0) {
    return <p className={`mt-2 ${hintClass}`}>This tool takes no arguments.</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      {schema.map((parameter) => {
        const draft = draftFor(parameter);
        const error = errors[parameter.name];
        const fieldId = `arg-${parameter.name}`;

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
              <p className={`mt-0.5 ${hintClass}`}>
                {parameter.description.slice(0, 200)}
              </p>
            ) : null}

            <div className="mt-1">
              {parameter.options && !PLACEHOLDER.test(draft) ? (
                <select
                  id={fieldId}
                  className={fieldClass}
                  value={draft}
                  onChange={(event) => commit(parameter, event.target.value)}
                >
                  <option value="">(unset)</option>
                  {parameter.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : parameter.type === "boolean" && !PLACEHOLDER.test(draft) ? (
                <select
                  id={fieldId}
                  className={fieldClass}
                  value={draft}
                  onChange={(event) => commit(parameter, event.target.value)}
                >
                  <option value="">(unset)</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
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

            {error ? (
              <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}

      {extras.length > 0 ? (
        <div className="border-t border-[#ebebeb] pt-2 dark:border-[#1a1a1a]">
          <p className={labelClass}>Not accepted by this tool</p>
          <p className={`mt-0.5 ${hintClass}`}>
            Saved on the node, but dropped when it runs.
          </p>
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
