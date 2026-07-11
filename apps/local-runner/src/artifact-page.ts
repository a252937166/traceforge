function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export interface LocalArtifactPageOptions {
  nonce: string;
  eyebrow: string;
  title: string;
  description: string;
  content: string;
  rawHref: string;
  rawLabel: string;
}

export function renderLocalArtifactPage(options: LocalArtifactPageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} · TraceForge Local Runner</title>
  <style nonce="${options.nonce}">
    :root { color-scheme: light; --ink:#13252e; --muted:#64737b; --mist:#e8eef1; --paper:#f9fbfc; --line:#aebdc5; --cobalt:#2e58cf; --mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace; --sans:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:var(--mist); font-family:var(--sans); }
    .shell { width:min(1180px,calc(100% - 40px)); margin:0 auto; padding:24px 0 44px; }
    header { display:flex; justify-content:space-between; gap:20px; align-items:center; padding:18px 0 22px; border-top:5px solid var(--cobalt); }
    .brand { font-weight:900; letter-spacing:.14em; font-size:14px; }
    .brand span { color:var(--cobalt); }
    a { color:inherit; }
    .back { padding:9px 12px; border:1px solid var(--ink); background:var(--paper); font:700 11px/1 var(--mono); text-decoration:none; text-transform:uppercase; letter-spacing:.06em; }
    main { border:1px solid var(--ink); background:var(--paper); box-shadow:10px 10px 0 rgba(19,37,46,.09); }
    .intro { padding:34px 40px 30px; border-bottom:1px solid var(--ink); }
    .eyebrow { margin:0 0 14px; color:var(--cobalt); font:800 11px/1.4 var(--mono); letter-spacing:.1em; text-transform:uppercase; }
    h1 { margin:0; font-size:clamp(34px,5vw,62px); line-height:.98; letter-spacing:-.045em; }
    .description { margin:18px 0 0; max-width:760px; color:var(--muted); font-size:15px; line-height:1.55; }
    .bar { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:13px 18px; border-bottom:1px solid var(--ink); background:#f1f4f6; font:700 11px/1.4 var(--mono); }
    .bar a { color:var(--cobalt); text-underline-offset:3px; }
    pre { margin:0; min-height:420px; max-height:72vh; overflow:auto; padding:26px; color:#dbe7ec; background:#102832; font:12px/1.65 var(--mono); tab-size:2; white-space:pre-wrap; overflow-wrap:anywhere; }
    @media (max-width:620px) { .shell{width:calc(100% - 20px);padding-top:10px}.brand span{display:none}.intro{padding:27px 22px 24px}.bar{align-items:flex-start;flex-direction:column}pre{padding:18px;font-size:11px} }
  </style>
</head>
<body>
  <div class="shell">
    <header><div class="brand">TRACEFORGE <span>/ LOCAL ARTIFACT</span></div><a class="back" href="/local">← Back to run</a></header>
    <main>
      <section class="intro">
        <p class="eyebrow">${escapeHtml(options.eyebrow)}</p>
        <h1>${escapeHtml(options.title)}</h1>
        <p class="description">${escapeHtml(options.description)}</p>
      </section>
      <div class="bar"><span>LOCAL · NO UPLOAD · NO CACHE</span><a href="${escapeHtml(options.rawHref)}">${escapeHtml(options.rawLabel)}</a></div>
      <pre><code>${escapeHtml(options.content)}</code></pre>
    </main>
  </div>
</body>
</html>`;
}
