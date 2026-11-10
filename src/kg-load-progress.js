const SLOW_MS = 8000;

export function createLoadReporter(root) {
  const panel = document.createElement("div");
  panel.className = "kg-load-panel";
  panel.id = "kgLoadPanel";
  panel.setAttribute("role", "status");
  panel.innerHTML = "<h2>Loading</h2><ul class=\"kg-load-steps\"></ul>";
  root.prepend(panel);

  const list = panel.querySelector(".kg-load-steps");
  const steps = new Map();
  const timers = new Map();

  const render = () => {
    list.innerHTML = [...steps.values()]
      .map((s) => {
        const cls = s.status === "error" ? "is-error" : s.status === "done" ? "is-done" : s.status === "slow" ? "is-slow" : "is-busy";
        const extra = s.error ? `<pre class="kg-load-err">${escapeHtml(s.error)}</pre>` : "";
        return `<li class="${cls}"><strong>${escapeHtml(s.title)}</strong> <span>${escapeHtml(s.detail || "")}</span>${extra}</li>`;
      })
      .join("");
  };

  return {
    start(id, title, detail = "") {
      steps.set(id, { id, title, detail, status: "busy", error: null });
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => {
          const row = steps.get(id);
          if (row && row.status === "busy") {
            row.status = "slow";
            row.detail = `${detail || row.detail} (still running — slow network?)`;
            render();
          }
        }, SLOW_MS),
      );
      render();
    },
    done(id, detail) {
      const row = steps.get(id);
      if (!row) return;
      clearTimeout(timers.get(id));
      row.status = "done";
      if (detail) row.detail = detail;
      row.error = null;
      render();
    },
    fail(id, message, url) {
      const row = steps.get(id);
      if (!row) {
        steps.set(id, { id, title: id, detail: url || "", status: "error", error: message });
      } else {
        clearTimeout(timers.get(id));
        row.status = "error";
        row.detail = url || row.detail;
        row.error = message;
      }
      panel.classList.add("has-error");
      render();
    },
    finish() {
      if (!panel.classList.contains("has-error")) {
        panel.classList.add("is-complete");
        setTimeout(() => panel.remove(), 1200);
      }
    },
  };
}

export async function fetchWithProgress(url, { signal, reporter, stepId, title, timeoutMs = 30000 } = {}) {
  reporter?.start(stepId, title, url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const mergeSignal = signal
    ? (() => {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
        return controller.signal;
      })()
    : controller.signal;

  try {
    const response = await fetch(url, { signal: mergeSignal });
    if (!response.ok) {
      const msg = `HTTP ${response.status} ${response.statusText}`;
      reporter?.fail(stepId, msg, url);
      throw new Error(`${msg} — ${url}`);
    }
    reporter?.done(stepId, url);
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    reporter?.fail(stepId, msg, url);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
