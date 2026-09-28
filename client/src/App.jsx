import { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";

const LANGS = {
  "C++": "cpp",
  C: "c",
  Java: "java",
  Python: "python",
  JavaScript: "javascript",
  TypeScript: "typescript",
};

const EXAMPLES = [
  { name: "C++", language: "C++", code: '#include <iostream>\nusing namespace std;\n\nint main() {\n  cout >> "Hello";\n  return 0;\n}', problem: "My output is not working." },
  { name: "C", language: "C", code: '#include <stdio.h>\n\nint main() {\n  printf("Hi")\n  return 0;\n}', problem: "It won't compile." },
  { name: "Java", language: "Java", code: 'public class Main {\n  public static void main(String[] args) {\n    int x = "5";\n    System.out.println(x);\n  }\n}', problem: "Incompatible types error." },
  { name: "Python", language: "Python", code: "for i in range(5)\n    print(i)", problem: "Syntax error." },
  { name: "JS", language: "JavaScript", code: 'let age = 18;\nif (age = 18) {\n  console.log("Adult");\n}', problem: "It always says Adult." },
  { name: "TS", language: "TypeScript", code: 'let count: number = "10";\nconsole.log(count + 1);', problem: "Type error." },
];

const STEPS = ["Paste", "Diagnose", "Think", "Fixed"];

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

function Terminal({ output, running }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/70">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px] text-zinc-500">
        <span>▸ terminal</span>
        <span>AI-simulated output</span>
      </div>
      <pre className="scroll-thin h-24 overflow-auto p-3 font-mono text-xs text-emerald-400">
        {running ? "Running..." : output || <span className="text-zinc-600">Press ▶ Run to see the output here.</span>}
      </pre>
    </div>
  );
}

function Section({ label, children, strong }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</div>
      <p className={strong ? "font-medium text-white" : "text-zinc-300"}>{children}</p>
    </div>
  );
}

export default function App() {
  const [language, setLanguage] = useState("C++");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState("");
  const [started, setStarted] = useState(false);
  const [tutor, setTutor] = useState({ diagnosis: "", feedback: "", wrong: false, question: "" });
  const [result, setResult] = useState(null);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [hints, setHints] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastMode, setLastMode] = useState("start");
  const [firstTry, setFirstTry] = useState(false);
  const [linting, setLinting] = useState(false);
  const [lintCount, setLintCount] = useState(0);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decoRef = useRef(null);
  const lintId = useRef(0);

  /* ---------- Live AI comments while typing ---------- */
  function handleMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decoRef.current = editor.createDecorationsCollection([]);
  }

  function applyIssues(issues) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    const decos = issues
      .filter((i) => Number.isInteger(i.line) && i.line >= 1 && i.line <= model.getLineCount())
      .map((i) => {
        const col = model.getLineMaxColumn(i.line);
        return {
          range: new monaco.Range(i.line, col, i.line, col),
          options: {
            isWholeLine: true,
            className: "ai-line",
            hoverMessage: { value: `🤖 ${i.message}` },
            after: { content: `   // 🤖 ${i.message}`, inlineClassName: "ai-comment" },
          },
        };
      });
    decoRef.current.set(decos);
    setLintCount(decos.length);
  }

  useEffect(() => {
    if (!editorRef.current) return;
    const id = ++lintId.current;
    if (!code.trim()) {
      decoRef.current?.clear();
      setLintCount(0);
      return;
    }
    const t = setTimeout(async () => {
      setLinting(true);
      try {
        const d = await post("/api/lint", { language, code });
        if (id === lintId.current) applyIssues(d.issues || []);
      } catch {
        /* ignore, typing must never break */
      }
      if (id === lintId.current) setLinting(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [code, language]);

  /* ---------- Tutor calls ---------- */
  async function call(mode, answerText = "") {
    setLoading(true);
    setErr("");
    setLastMode(mode);
    try {
      const d = await post("/api/debug", { language, code, error: problem, mode, answer: answerText, attempts });
      const correct = d.correct === true || d.correct === "true";
      const done = correct || !!d.solution;
      if (d.output) setOutput(d.output);
      if (mode === "start") setFirstTry(correct);

      if (done) {
        setResult({ ...d, correct });
      } else {
        setTutor((prev) => ({
          diagnosis: d.diagnosis || (mode === "start" ? "" : prev.diagnosis),
          feedback: d.hint || "",
          wrong: mode === "check",
          question: d.question || (mode === "start" ? "" : prev.question),
        }));
      }
      setStarted(true);
    } catch (e) {
      setErr(e.message || "Something went wrong.");
    }
    setLoading(false);
  }

  async function runCode(src = code) {
    if (!src.trim() || running) return;
    setRunning(true);
    try {
      const d = await post("/api/debug", { language, code: src, mode: "run" });
      setOutput(d.output || "(no output)");
    } catch (e) {
      setOutput("⚠ " + (e.message || "Could not run."));
    }
    setRunning(false);
  }

  function submitAnswer() {
    if (!answer.trim() || loading) return;
    setAttempts((a) => a + 1);
    call("answer", answer.trim());
    setAnswer("");
  }

  function onAnswerKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitAnswer();
    }
  }

  function checkFix() {
    setAttempts((a) => a + 1);
    call("check");
  }

  function getHint() {
    setHints((h) => h + 1);
    call("hint");
  }

  function applyFix(andRun = false) {
    setCode(result.solution);
    if (andRun) runCode(result.solution);
  }

  function reset() {
    setStarted(false);
    setTutor({ diagnosis: "", feedback: "", wrong: false, question: "" });
    setResult(null);
    setOutput("");
    setAttempts(0);
    setHints(0);
    setAnswer("");
    setErr("");
    setFirstTry(false);
  }

  function loadExample(ex) {
    reset();
    setLanguage(ex.language);
    setCode(ex.code);
    setProblem(ex.problem);
  }

  async function copyFix() {
    await navigator.clipboard.writeText(result?.solution || code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const solved = !!result;
  const stuck = attempts >= 2 && !solved;
  const step = solved ? 4 : !started ? 0 : attempts + hints > 0 ? 2 : 1;

  return (
    <div className="bg-app flex min-h-screen flex-col text-zinc-100 lg:h-screen lg:overflow-hidden">
      {/* NAV */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-black/30 px-4 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-indigo-400 text-base">🥋</div>
          <div>
            <h1 className="brand-text text-base font-extrabold leading-none">DebugDojo</h1>
            <p className="hidden text-[10px] text-zinc-500 sm:block">Find the bug yourself. Learn for life.</p>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  i < step ? "bg-emerald-400 text-black" : i === step ? "bg-cyan-400 text-black ring-2 ring-cyan-400/30" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`text-[11px] ${i <= step ? "text-zinc-200" : "text-zinc-600"}`}>{s}</span>
              {i < 3 && <div className={`h-px w-6 ${i < step ? "bg-emerald-400/60" : "bg-zinc-800"}`} />}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {started && (
            <>
              <span className="rounded-full bg-zinc-800 px-2.5 py-1">Attempts {attempts}</span>
              <span className="rounded-full bg-zinc-800 px-2.5 py-1">Hints {hints}</span>
              <button onClick={reset} className="card rounded-lg px-3 py-1.5 text-zinc-300 hover:text-white">↺ New</button>
            </>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-2">
        {/* LEFT: EDITOR */}
        <section className="card flex min-h-0 flex-col gap-2 rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={language}
              disabled={started}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs outline-none focus:border-emerald-400 disabled:opacity-60"
            >
              {Object.keys(LANGS).map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.name}
                onClick={() => loadExample(ex)}
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
              >
                {ex.name}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-amber-300/80">
                {linting ? "🤖 checking..." : lintCount > 0 ? `🤖 ${lintCount} note${lintCount > 1 ? "s" : ""}` : ""}
              </span>
              <button
                onClick={() => runCode()}
                disabled={running || !code.trim()}
                className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-bold text-black transition hover:bg-emerald-300 disabled:opacity-40"
              >
                {running ? "Running..." : "▶ Run"}
              </button>
            </div>
          </div>

          <div className="h-[300px] overflow-hidden rounded-xl border border-white/10 lg:h-auto lg:min-h-0 lg:flex-1">
            <Editor
              height="100%"
              theme="vs-dark"
              language={LANGS[language]}
              value={code}
              onChange={(v) => setCode(v || "")}
              onMount={handleMount}
              options={{ minimap: { enabled: false }, fontSize: 13, padding: { top: 10 }, scrollBeyondLastLine: false, automaticLayout: true }}
            />
          </div>

          <Terminal output={output} running={running} />

          <div className="flex gap-2">
            <input
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="What's going wrong? (optional)"
              className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
            {!started ? (
              <button
                onClick={() => call("start")}
                disabled={loading || !code.trim()}
                className="shrink-0 rounded-xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400 px-5 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-40"
              >
                {loading ? "Analyzing..." : "🚀 Start"}
              </button>
            ) : (
              !solved && (
                <button
                  onClick={checkFix}
                  disabled={loading}
                  className="shrink-0 rounded-xl border border-emerald-400/50 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-50"
                >
                  ✅ Check my fix
                </button>
              )
            )}
          </div>
        </section>

        {/* RIGHT: TUTOR */}
        <section className="card flex min-h-[420px] min-h-0 flex-col rounded-2xl p-3">
          <h2 className="mb-2 flex shrink-0 items-center gap-2 text-sm font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20">🧑‍🏫</span>
            Your Tutor
          </h2>

          <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {!started && !loading && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 p-6 text-center text-sm text-zinc-400">
                <div className="mb-2 text-4xl">🐞</div>
                Write or paste code, or tap an example.
                <br />
                Then press <b className="text-zinc-200">Start</b>.
                <span className="mt-2 text-xs text-zinc-500">While you type, I will leave 🤖 comments on suspicious lines.</span>
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
                Tutor is thinking...
              </div>
            )}

            {err && (
              <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">
                {err}{" "}
                <button onClick={() => call(started ? lastMode : "start")} className="underline">Retry</button>
              </p>
            )}

            {/* TUTOR NOTE (single style) */}
            {started && !solved && !loading && (tutor.diagnosis || tutor.feedback || tutor.question) && (
              <div className="fade-up space-y-3 rounded-2xl border border-white/10 border-l-emerald-400/70 bg-white/[0.04] p-4 text-sm leading-relaxed [border-left-width:3px]">
                {tutor.diagnosis && <Section label="What I see">{tutor.diagnosis}</Section>}
                {tutor.feedback && <Section label={tutor.wrong ? "Not yet" : "Tutor"}>{tutor.feedback}</Section>}
                {tutor.question && <Section label="Your turn" strong>{tutor.question}</Section>}
              </div>
            )}

            {/* RESULT */}
            {solved && (
              <div className="fade-up space-y-3">
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                  <h3 className="text-base font-bold">
                    {firstTry ? "🎉 Your code is correct. Good job!" : result.correct ? "🎉 You fixed it!" : "✅ Here's the fix"}
                  </h3>
                  {!firstTry && (
                    <p className="text-xs text-zinc-400">
                      {attempts} attempt{attempts === 1 ? "" : "s"} · {hints} hint{hints === 1 ? "" : "s"}
                    </p>
                  )}
                  {result.correct && result.hint && <p className="mt-1 text-sm text-emerald-100">{result.hint}</p>}
                  {result.output && <p className="mt-1 text-xs text-zinc-400">See the output in the terminal on the left ←</p>}
                </div>

                {result.solution && (
                  <div className="overflow-hidden rounded-2xl border border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-400">
                      <span>Fixed code</span>
                      <div className="flex gap-2">
                        <button onClick={copyFix} className="rounded-md px-2 py-1 hover:bg-white/10 hover:text-white">{copied ? "Copied ✓" : "Copy"}</button>
                        <button onClick={() => applyFix(false)} className="rounded-md px-2 py-1 hover:bg-white/10 hover:text-white">Apply to editor</button>
                        <button onClick={() => applyFix(true)} className="rounded-md bg-emerald-400 px-2.5 py-1 font-semibold text-black hover:bg-emerald-300">▶ Apply & Run</button>
                      </div>
                    </div>
                    <pre className="scroll-thin max-h-48 overflow-auto p-3 font-mono text-xs">{result.solution}</pre>
                  </div>
                )}

                {result.explanation && (
                  <p className="text-sm text-zinc-300">
                    <b className="text-zinc-100">{firstTry ? "What it does:" : "Why:"}</b> {result.explanation}
                  </p>
                )}
                {result.takeaway && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-200">
                    <b>📘 What you learned:</b> {result.takeaway}
                  </div>
                )}
                <button onClick={reset} className="rounded-xl bg-emerald-400 px-5 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300">
                  Try Another Bug
                </button>
              </div>
            )}
          </div>

          {/* INPUT */}
          {started && !solved && (
            <div className="mt-2 shrink-0 space-y-2 border-t border-white/5 pt-2">
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={onAnswerKey}
                placeholder="Type your answer... (Enter = send, Shift+Enter = new line)"
                rows={2}
                className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 p-2.5 text-sm outline-none focus:border-emerald-400"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={submitAnswer} disabled={loading || !answer.trim()} className="rounded-lg bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40">
                  Send ➤
                </button>
                <button onClick={getHint} disabled={loading} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50">
                  💡 Hint
                </button>
                <button
                  onClick={() => call("solve")}
                  disabled={loading}
                  className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 ${stuck ? "animate-pulse bg-rose-500 font-semibold text-white" : "bg-zinc-800 hover:bg-zinc-700"}`}
                >
                  🔓 Show me the fix
                </button>
                {stuck && <span className="text-xs text-rose-300">Stuck? That's okay!</span>}
              </div>
            </div>
          )}
          </section>
          </main>
          </div>
  )}