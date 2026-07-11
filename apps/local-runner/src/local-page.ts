export interface LocalPageOptions {
  nonce: string;
  csrfToken: string;
}

export function renderLocalPage({ nonce, csrfToken }: LocalPageOptions): string {
  const csrf = JSON.stringify(csrfToken).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="referrer" content="no-referrer">
  <title>TraceForge Local Runner</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light;
      --ink: #13252e;
      --muted: #64737b;
      --mist: #e8eef1;
      --paper: #f9fbfc;
      --line: #aebdc5;
      --cobalt: #2e58cf;
      --cobalt-soft: #dfe7ff;
      --signal: #bf4d46;
      --green: #168469;
      --amber: #9b6a11;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { background: var(--mist); color: var(--ink); font-family: var(--sans); }
    body { margin: 0; min-height: 100vh; background:
      linear-gradient(90deg, transparent 0 49.92%, rgba(19, 37, 46, .035) 49.92% 50.08%, transparent 50.08%),
      var(--mist); }
    button, a { font: inherit; }
    button:focus-visible, a:focus-visible { outline: 3px solid var(--cobalt); outline-offset: 3px; }
    .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 24px 0 52px; }
    .masthead { display: flex; justify-content: space-between; align-items: center; border-top: 5px solid var(--cobalt); padding: 18px 0 22px; }
    .brand { display: flex; gap: 12px; align-items: baseline; font-weight: 900; letter-spacing: .14em; font-size: 14px; }
    .brand span { color: var(--cobalt); }
    .local-badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 11px; border: 1px solid var(--ink); background: var(--paper); font: 700 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .local-badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px rgba(22,132,105,.14); }
    main { border: 1px solid var(--ink); background: var(--paper); box-shadow: 10px 10px 0 rgba(19, 37, 46, .09); }
    .intro { display: grid; grid-template-columns: 1.35fr .65fr; min-height: 250px; border-bottom: 1px solid var(--ink); }
    .intro-copy { padding: 38px 42px 40px; }
    .eyebrow { margin: 0 0 18px; color: var(--cobalt); font: 800 12px/1.4 var(--mono); letter-spacing: .11em; text-transform: uppercase; }
    h1 { margin: 0; max-width: 760px; font-size: clamp(38px, 6vw, 72px); line-height: .94; letter-spacing: -.055em; }
    .lede { margin: 24px 0 0; max-width: 730px; color: var(--muted); font-size: 17px; line-height: 1.55; }
    .intro-mark { position: relative; display: grid; place-items: center; overflow: hidden; border-left: 1px solid var(--ink); background: var(--cobalt); color: white; }
    .intro-mark::before { content: "LOCAL"; position: absolute; transform: rotate(-42deg); font: 900 clamp(76px, 11vw, 150px)/1 var(--sans); letter-spacing: -.08em; opacity: .09; }
    .mark-data { position: relative; display: grid; gap: 10px; text-align: center; }
    .mark-data strong { font: 900 clamp(42px, 6vw, 72px)/1 var(--sans); }
    .mark-data span { font: 700 11px/1.5 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
    .provenance { padding: 0 42px 34px; border-bottom: 1px solid var(--ink); }
    .section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; padding: 28px 0 18px; }
    .section-heading h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .section-heading p { margin: 0; color: var(--muted); font: 12px/1.4 var(--mono); }
    .provenance-line { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--ink); }
    .provenance-step { position: relative; min-height: 118px; padding: 19px 20px 18px; background: #fff; border-right: 1px solid var(--ink); }
    .provenance-step:last-child { border-right: 0; }
    .provenance-step::after { content: "→"; position: absolute; z-index: 2; top: 44px; right: -14px; width: 27px; height: 27px; display: grid; place-items: center; color: var(--cobalt); background: var(--paper); border: 1px solid var(--ink); font-weight: 900; }
    .provenance-step:last-child::after { display: none; }
    .step-number { color: var(--cobalt); font: 700 11px/1 var(--mono); }
    .step-name { display: block; margin-top: 20px; font-weight: 850; font-size: 15px; }
    .step-state { display: inline-block; margin-top: 9px; color: var(--muted); font: 700 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .provenance-step[data-state="recorded"] { background: #f1f4f6; }
    .provenance-step[data-state="live"] { background: var(--cobalt-soft); box-shadow: inset 0 -5px 0 var(--cobalt); }
    .provenance-step[data-state="passed"] { background: #e4f3ee; box-shadow: inset 0 -5px 0 var(--green); }
    .provenance-step[data-state="failed"] { background: #f8e7e5; box-shadow: inset 0 -5px 0 var(--signal); }
    .work-grid { display: grid; grid-template-columns: 1fr 1fr; }
    .scope { padding: 0 42px 38px; border-right: 1px solid var(--ink); }
    .scope-list { border-top: 1px solid var(--line); }
    .scope-row { display: grid; grid-template-columns: 100px 1fr; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); }
    .scope-row dt { margin: 0; color: var(--muted); font: 700 11px/1.5 var(--mono); text-transform: uppercase; }
    .scope-row dd { margin: 0; font-size: 14px; line-height: 1.5; }
    .scope-note { margin: 18px 0 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
    .gate-compare { display: grid; margin-top: 20px; border: 1px solid var(--line); background: #fff; }
    .gate-row { display: grid; grid-template-columns: 128px 1fr; gap: 14px; padding: 13px 14px; border-bottom: 1px solid var(--line); }
    .gate-row:last-child { border-bottom: 0; }
    .gate-row span { color: var(--cobalt); font: 800 10px/1.4 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
    .gate-row strong { font-size: 12px; line-height: 1.45; }
    .state-panel { display: flex; flex-direction: column; min-height: 405px; }
    .state-head { display: flex; align-items: center; justify-content: space-between; min-height: 72px; padding: 16px 24px; border-bottom: 1px solid var(--ink); }
    .phase { color: var(--cobalt); font: 800 11px/1.4 var(--mono); letter-spacing: .09em; text-transform: uppercase; }
    .model { color: var(--muted); font: 11px/1.4 var(--mono); }
    .state-body { flex: 1; padding: 30px 30px 24px; }
    .state-body h2 { margin: 0; font-size: clamp(24px, 3vw, 34px); line-height: 1.08; letter-spacing: -.035em; }
    .state-message { margin: 17px 0 0; max-width: 520px; color: var(--muted); line-height: 1.55; }
    .state-detail { min-height: 21px; margin: 14px 0 0; color: var(--ink); font: 12px/1.55 var(--mono); overflow-wrap: anywhere; }
    .run-result { display: none; grid-template-columns: repeat(4, 1fr); margin-top: 24px; border: 1px solid var(--line); }
    .run-result[data-visible="true"] { display: grid; }
    .metric { padding: 15px; border-right: 1px solid var(--line); }
    .metric:last-child { border-right: 0; }
    .metric strong { display: block; font-size: 21px; }
    .metric span { display: block; margin-top: 5px; color: var(--muted); font: 9px/1.35 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .error { display: none; margin-top: 18px; padding: 12px 14px; color: #7a2924; background: #f8e7e5; border-left: 4px solid var(--signal); font: 12px/1.45 var(--mono); overflow-wrap: anywhere; white-space: pre-line; }
    .error[data-visible="true"] { display: block; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 18px 24px; border-top: 1px solid var(--ink); background: #f1f4f6; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 45px; padding: 0 18px; border: 1px solid var(--ink); color: var(--ink); background: #fff; font-weight: 800; cursor: pointer; text-decoration: none; }
    .button:hover { transform: translate(-2px, -2px); box-shadow: 3px 3px 0 var(--ink); }
    .button-primary { color: #fff; background: var(--cobalt); }
    .button-danger { margin-left: auto; color: #842e29; background: transparent; border-color: #a75a55; }
    .button[hidden] { display: none; }
    .button:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
    .boundary { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--ink); }
    .boundary-item { padding: 16px 22px; border-right: 1px solid var(--ink); }
    .boundary-item:last-child { border-right: 0; }
    .boundary-item span { display: block; color: var(--muted); font: 10px/1.4 var(--mono); letter-spacing: .07em; text-transform: uppercase; }
    .boundary-item strong { display: block; margin-top: 5px; font-size: 13px; }
    @media (max-width: 820px) {
      .shell { width: min(100% - 20px, 680px); padding-top: 10px; }
      .masthead { padding: 15px 0; }
      .intro, .work-grid { grid-template-columns: 1fr; }
      .intro-copy, .provenance, .scope { padding-left: 22px; padding-right: 22px; }
      .intro-mark { min-height: 150px; border-left: 0; border-top: 1px solid var(--ink); }
      .provenance-line { grid-template-columns: 1fr 1fr; }
      .provenance-step:nth-child(2) { border-right: 0; }
      .provenance-step:nth-child(-n+2) { border-bottom: 1px solid var(--ink); }
      .provenance-step:nth-child(2)::after { display: none; }
      .scope { border-right: 0; border-bottom: 1px solid var(--ink); }
      .boundary { grid-template-columns: 1fr; }
      .boundary-item { border-right: 0; border-bottom: 1px solid var(--ink); }
      .boundary-item:last-child { border-bottom: 0; }
    }
    @media (max-width: 520px) {
      .brand span { display: none; }
      .local-badge { font-size: 9px; }
      .intro-copy { padding-top: 30px; }
      .provenance-line { grid-template-columns: 1fr; }
      .provenance-step { border-right: 0; border-bottom: 1px solid var(--ink); min-height: 96px; }
      .provenance-step:last-child { border-bottom: 0; }
      .provenance-step::after { display: none; }
      .step-name { margin-top: 12px; }
      .section-heading { align-items: flex-start; flex-direction: column; }
      .scope-row { grid-template-columns: 76px 1fr; }
      .gate-row { grid-template-columns: 1fr; gap: 6px; }
      .actions { padding: 15px; }
      .button { width: 100%; }
      .button-danger { margin-left: 0; }
      .run-result { grid-template-columns: 1fr; }
      .metric { border-right: 0; border-bottom: 1px solid var(--line); }
    }
    @media (prefers-reduced-motion: no-preference) {
      .provenance-step[data-state="live"] { animation: pulse 1.8s ease-in-out infinite; }
      @keyframes pulse { 50% { background: #eef2ff; } }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="masthead">
      <div class="brand">TRACEFORGE <span>/ LOCAL RUNNER</span></div>
      <div class="local-badge">127.0.0.1 · private session</div>
    </header>
    <main>
      <section class="intro">
        <div class="intro-copy">
          <p class="eyebrow">Recorded archaeology · live local build</p>
          <h1>Build one bounded workflow on this machine.</h1>
          <p class="lede">TraceForge gives your local Codex only the recorded contract, failed proofs, and one incomplete candidate. A separate local verifier then issues a fresh proof.</p>
        </div>
        <div class="intro-mark" aria-hidden="true">
          <div class="mark-data"><strong>01</strong><span>writable source file<br>no push · no deploy</span></div>
        </div>
      </section>

      <section class="provenance" aria-labelledby="provenance-heading">
        <div class="section-heading">
          <h2 id="provenance-heading">Provenance handoff</h2>
          <p>What is recorded, what is live, and what becomes proof.</p>
        </div>
        <div class="provenance-line">
          <article class="provenance-step" id="step-evidence" data-state="recorded"><span class="step-number">01</span><strong class="step-name">Recorded evidence</strong><span class="step-state">Recorded GPT-5.6</span></article>
          <article class="provenance-step" id="step-codex" data-state="waiting"><span class="step-number">02</span><strong class="step-name">Local Codex build</strong><span class="step-state">Waiting</span></article>
          <article class="provenance-step" id="step-verifier" data-state="waiting"><span class="step-number">03</span><strong class="step-name">Local verify</strong><span class="step-state">Waiting</span></article>
          <article class="provenance-step" id="step-proof" data-state="waiting"><span class="step-number">04</span><strong class="step-name">Fresh proof</strong><span class="step-state">Waiting</span></article>
        </div>
      </section>

      <div class="work-grid">
        <section class="scope" aria-labelledby="scope-heading">
          <div class="section-heading"><h2 id="scope-heading">Execution scope</h2><p>Fixed by the runner</p></div>
          <dl class="scope-list">
            <div class="scope-row"><dt>Read</dt><dd>Behavior contract · failed proofs · disclosed scenarios · incomplete candidate</dd></div>
            <div class="scope-row"><dt>Write</dt><dd>One candidate TypeScript file inside a temporary writer workspace</dd></div>
            <div class="scope-row"><dt>Hidden</dt><dd>Legacy implementation · verifier · tests · final host-generated input</dd></div>
            <div class="scope-row"><dt>Network</dt><dd>Codex service connection required · agent command network disabled</dd></div>
            <div class="scope-row"><dt>Git</dt><dd>No commit · no push · no merge · no deploy</dd></div>
          </dl>
          <p class="scope-note">Codex sends the bounded build context to OpenAI. Credentials, generated source, diff, and proof are not uploaded to the TraceForge website.</p>
          <div class="gate-compare" aria-label="Verification gate comparison">
            <div class="gate-row"><span>Local gate</span><strong>15 focused candidate tests + 7 differential scenarios</strong></div>
            <div class="gate-row"><span>Source champion gate</span><strong>55 candidate-safe tests + 4 separate replay guards</strong></div>
          </div>
        </section>

        <section class="state-panel" aria-labelledby="state-title">
          <div class="state-head"><span class="phase" id="phase">Preflight</span><span class="model" id="model">gpt-5.6-sol</span></div>
          <div class="state-body" aria-live="polite">
            <h2 id="state-title">Checking the local trust boundary</h2>
            <p class="state-message" id="state-message">TraceForge is checking Codex, its dedicated sign-in, and the pinned demo fixture.</p>
            <p class="state-detail" id="state-detail"></p>
            <div class="error" id="error" data-visible="false"></div>
            <div class="run-result" id="run-result" data-visible="false">
              <div class="metric"><strong id="metric-tests">—</strong><span>Focused tests passed</span></div>
              <div class="metric"><strong id="metric-scenarios">—</strong><span>Scenarios passed</span></div>
              <div class="metric"><strong id="metric-assertions">—</strong><span>Assertions passed</span></div>
              <div class="metric"><strong id="metric-mismatches">—</strong><span>Mismatches</span></div>
            </div>
          </div>
          <div class="actions">
            <button class="button button-primary" id="login" hidden>Sign in with ChatGPT</button>
            <button class="button button-primary" id="start" hidden>Start local build</button>
            <a class="button button-primary" id="proof" href="/api/proof?view=html" hidden>Open proof bundle</a>
            <a class="button" id="diff" href="/api/diff?view=html" hidden>Inspect diff</a>
            <button class="button" id="retry" hidden>Retry preflight</button>
            <button class="button button-danger" id="delete">Cancel and delete session</button>
          </div>
        </section>
      </div>
      <footer class="boundary">
        <div class="boundary-item"><span>Authentication</span><strong>Owned by local Codex</strong></div>
        <div class="boundary-item"><span>Writer boundary</span><strong>One file · permission profile</strong></div>
        <div class="boundary-item"><span>Verifier boundary</span><strong>Second sandbox · fresh nonce</strong></div>
      </footer>
    </main>
  </div>
  <script nonce="${nonce}">
    "use strict";
    document.documentElement.dataset.traceforgeRunner = "ready";
    const csrf = ${csrf};
    const byId = (id) => document.getElementById(id);
    const stateLabels = { recorded: "Recorded GPT-5.6", waiting: "Waiting", live: "Live on this machine", passed: "Passed", failed: "Failed" };
    const commandDiagnostics = {
      install: { label: "Offline dependency check", command: "corepack pnpm install --offline --frozen-lockfile" },
      apiTests: { label: "Candidate-safe API tests", command: "corepack pnpm --filter @traceforge/api exec node --test --import tsx tests/champion-workflow.test.ts tests/workflow.test.ts" },
      generatedSuite: { label: "Six-scenario differential suite", command: "corepack pnpm --filter @traceforge/api exec node --import tsx scripts/verify-generated.ts" },
    };
    const busyPhases = new Set(["preflight", "signing-in", "preparing", "codex", "verifying", "deleting"]);

    function setStep(name, value) {
      const node = byId("step-" + name);
      node.dataset.state = value;
      node.querySelector(".step-state").textContent = stateLabels[value] || value;
    }

    function render(snapshot) {
      byId("phase").textContent = snapshot.phase.replaceAll("-", " ");
      byId("state-title").textContent = snapshot.title;
      byId("state-message").textContent = snapshot.message;
      const details = [
        snapshot.detail,
        snapshot.localReleaseCommit ? "Local executable " + snapshot.localReleaseCommit : "",
        snapshot.threadId ? "Thread " + snapshot.threadId : "",
        snapshot.codexVersion,
      ].filter(Boolean);
      byId("state-detail").textContent = details.join(" · ");
      byId("model").textContent = snapshot.model + (snapshot.accountLabel ? " · " + snapshot.accountLabel : "");
      setStep("evidence", snapshot.provenance.evidence);
      setStep("codex", snapshot.provenance.codex);
      setStep("verifier", snapshot.provenance.verifier);
      setStep("proof", snapshot.provenance.proof);

      const error = byId("error");
      error.dataset.visible = snapshot.errorCode ? "true" : "false";
      const failedCommand = snapshot.result && commandDiagnostics[snapshot.result.failedCommand];
      const commandDetail = failedCommand
        ? "\\nVerification command exited non-zero\\n" + failedCommand.label + "\\n" + failedCommand.command + "\\nCommand output is not displayed; only its digests are included in the proof."
        : "";
      const diagnosticDetail = snapshot.result && snapshot.result.failureCode
        ? "\\nDiagnostic code · " + snapshot.result.failureCode
        : "";
      error.textContent = snapshot.errorCode ? "Diagnostic code · " + snapshot.errorCode + commandDetail + diagnosticDetail : "";
      byId("login").hidden = snapshot.phase !== "needs-auth";
      byId("start").hidden = snapshot.phase !== "ready";
      byId("proof").hidden = !snapshot.result;
      byId("diff").hidden = !snapshot.result;
      byId("retry").hidden = snapshot.phase !== "failed" || Boolean(snapshot.result);
      byId("delete").hidden = snapshot.phase === "deleted";
      byId("delete").disabled = snapshot.phase === "deleting";
      const result = byId("run-result");
      result.dataset.visible = snapshot.result ? "true" : "false";
      if (snapshot.result) {
        byId("metric-tests").textContent = snapshot.result.testsPassed + "/" + snapshot.result.testsTotal;
        byId("metric-scenarios").textContent = snapshot.result.scenariosPassed + "/" + snapshot.result.scenariosTotal;
        byId("metric-assertions").textContent = snapshot.result.assertionsPassed + "/" + snapshot.result.assertionCount;
        byId("metric-mismatches").textContent = String(snapshot.result.mismatchCount);
      }
      document.title = snapshot.phase === "passed" ? "Fresh proof · TraceForge Local Runner" : "TraceForge Local Runner";
    }

    async function action(name) {
      for (const button of document.querySelectorAll("button")) button.disabled = true;
      try {
        const response = await fetch("/api/" + name, {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-TraceForge-CSRF": csrf, "Content-Type": "application/json" },
          body: "{}",
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "LOCAL_REQUEST_FAILED");
        render(body);
      } catch (error) {
        byId("error").dataset.visible = "true";
        byId("error").textContent = error instanceof Error ? error.message : "LOCAL_REQUEST_FAILED";
      } finally {
        for (const button of document.querySelectorAll("button")) button.disabled = false;
      }
    }

    byId("login").addEventListener("click", () => void action("login"));
    byId("start").addEventListener("click", () => void action("start"));
    byId("retry").addEventListener("click", () => void action("retry"));
    byId("delete").addEventListener("click", () => void action("delete"));
    document.documentElement.dataset.traceforgeRunner = "bindings";

    fetch("/api/state", { credentials: "same-origin" })
      .then(async (response) => {
        document.documentElement.dataset.traceforgeStateStatus = String(response.status);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "LOCAL_STATE_REQUEST_FAILED");
        return body;
      })
      .then(render)
      .catch((error) => {
        document.documentElement.dataset.traceforgeFetchError = String(error);
        byId("error").dataset.visible = "true";
        byId("error").textContent = "Local state connection failed. Reload this page.";
      });
    document.documentElement.dataset.traceforgeRunner = "fetch";
    const events = new EventSource("/api/events");
    events.onmessage = (event) => render(JSON.parse(event.data));
    events.onerror = () => {
      document.documentElement.dataset.traceforgeEventError = "event-source";
    };
    document.documentElement.dataset.traceforgeRunner = "events";
  </script>
</body>
</html>`;
}
