// MemoryPanel - the AMT Memory widget for ChatGPT (Apps SDK / MCP Apps).
//
// Rendered inside ChatGPT's iframe. It reads the render tool's structuredContent from the
// host bridge (window.openai.toolOutput, the ChatGPT alias for the MCP Apps
// ui/notifications/tool-result payload) and shows what AMT remembers about the signed-in
// user, grouped into Personal / Team / Org. Actions go back through the bridge: "Refresh"
// re-calls the render tool, and each memory can seed a follow-up message to the model.
//
// This is authored as a React component and bundled (with React) by scripts/build-widget.mjs
// into a single self-contained module, so it runs in the sandboxed iframe with no runtime
// network fetch for the framework.

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/** @typedef {{ id: string, scope_key: string, type: string, content: string }} PanelMemory */

function useOpenAiGlobal(key) {
  const read = () => (typeof window !== "undefined" && window.openai ? window.openai[key] : undefined);
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onUpdate = () => setValue(read());
    // ChatGPT dispatches "openai:set_globals" whenever toolOutput/toolInput/etc. change.
    window.addEventListener("openai:set_globals", onUpdate);
    return () => window.removeEventListener("openai:set_globals", onUpdate);
  }, [key]);
  return value;
}

function callTool(name, args) {
  if (window.openai?.callTool) return window.openai.callTool(name, args ?? {});
  return Promise.reject(new Error("host bridge unavailable"));
}

function sendFollowUp(prompt) {
  const bridge = window.openai;
  if (!bridge) return;
  if (typeof bridge.sendFollowUpMessage === "function") {
    // Accept both the object and bare-string signatures across host versions.
    try {
      bridge.sendFollowUpMessage({ prompt });
    } catch {
      bridge.sendFollowUpMessage(prompt);
    }
  }
}

function Column({ title, tone, items }) {
  return (
    <section className={`amt-col amt-${tone}`}>
      <header className="amt-col-head">
        <span className="amt-dot" />
        <h3>{title}</h3>
        <span className="amt-count">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="amt-empty">Nothing here yet.</p>
      ) : (
        <ul>
          {items.map((m) => (
            <li key={m.id || m.content}>
              <button
                className="amt-item"
                title="Ask about this memory"
                onClick={() => sendFollowUp(`Tell me more about this memory and how it applies: "${m.content}"`)}
              >
                <span className="amt-type">{m.type}</span>
                <span className="amt-content">{m.content}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MemoryPanel() {
  const toolOutput = useOpenAiGlobal("toolOutput");
  const [busy, setBusy] = useState(false);

  const panel = toolOutput && toolOutput.groups ? toolOutput : { principal: "", tenant: "", groups: { personal: [], team: [], org: [] } };
  const { personal = [], team = [], org = [] } = panel.groups || {};

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await callTool("show_memory_panel", {});
    } catch {
      /* host will surface errors in the thread */
    } finally {
      setBusy(false);
    }
  }, []);

  const total = personal.length + team.length + org.length;

  return (
    <div className="amt-root">
      <div className="amt-bar">
        <div className="amt-title">
          <strong>AMT Memory</strong>
          {panel.principal ? <span className="amt-who">{panel.principal}</span> : null}
        </div>
        <button className="amt-refresh" onClick={refresh} disabled={busy}>
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {total === 0 ? (
        <p className="amt-empty amt-empty-all">
          No memories to show yet. As you work, ask the agent to remember decisions and conventions,
          then Refresh.
        </p>
      ) : (
        <div className="amt-cols">
          <Column title="Personal" tone="personal" items={personal} />
          <Column title="Team" tone="team" items={team} />
          <Column title="Org" tone="org" items={org} />
        </div>
      )}
    </div>
  );
}

const rootEl = document.getElementById("amt-root");
if (rootEl) createRoot(rootEl).render(<MemoryPanel />);
