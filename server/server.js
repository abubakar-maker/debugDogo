import "dotenv/config";
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();
app.use(cors());
app.use(cors({origin:"https://debug-dogo.vercel.app"}))
app.use(express.json({ limit: "20kb" }));

const client = new Groq(); // reads GROQ_API_KEY from .env
const MODEL = "openai/gpt-oss-120b";
const LINT_MODEL = "openai/gpt-oss-120b";

const SYSTEM = `You are a patient programming tutor for beginners. Speak directly to the learner in 1-2 short sentences per field.
Never give the fixed code unless mode is "solve".
Reply with ONLY valid JSON with these keys:
{"diagnosis":"","question":"","hint":"","solution":"","explanation":"","takeaway":"","output":"","correct":false}
Modes:
- "start": FIRST decide if the code already works with no bug.
  If correct: correct=true, output=exact terminal output, hint=short praise, explanation=one sentence on what the code does, takeaway=one lesson. Leave the rest empty.
  If it has a bug: correct=false, diagnosis=short, question=one diagnostic question. Leave the rest empty. Do NOT reveal the fix.
- "answer": judge the learner's answer. Put feedback in hint. Ask a follow-up in question if needed. correct=false.
- "hint": give a stronger hint in hint. No fixed code. correct=false.
- "check": the learner edited the code. If it works now: correct=true, output=exact terminal output, hint=short praise, explanation=why it works, takeaway=one lesson. If not: correct=false, hint=a nudge about what is still wrong. No fixed code.
- "solve": solution=corrected code only (no markdown, preserve line breaks and indentation exactly), output=exact terminal output of the fixed code, explanation=why, takeaway=one lesson.
- "run": ONLY fill output = the exact terminal output if this code were run, or the exact compiler/runtime error message if it fails. Leave everything else empty.
Keep every field short and friendly.`;

const LINT_SYSTEM = `Beginner code reviewer. Lines are numbered "N|code".
Find at most 2 clear bugs (syntax, wrong operator, type mistake). Ignore the very last line if it looks unfinished. Ignore style.
Reply ONLY JSON: {"issues":[{"line":3,"message":"..."}]}
Message: max 8 words, friendly, a little funny, hints at the problem without giving the fix.
No bugs → {"issues":[]}`;

app.post("/api/debug", async (req, res) => {
  const { language, code, error, mode, answer, attempts } = req.body;

  if (!code || !code.trim()) {
    return res.status(400).json({ error: "Please paste some code first." });
  }

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Mode: ${mode}\nLanguage: ${language}\nCode:\n${code}\nProblem: ${error || "none"}\nLearner answer: ${answer || "none"}\nAttempts so far: ${attempts || 0}`,
        },
      ],
    });

    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI failed. Please try again." });
  }
});

app.post("/api/lint", async (req, res) => {
  const { language, code } = req.body;
  if (!code || !code.trim()) return res.json({ issues: [] });

  const numbered = code
    .split("\n")
    .map((l, i) => `${i + 1}|${l}`)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: LINT_MODEL,
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: LINT_SYSTEM },
        { role: "user", content: `${language}:\n${numbered}` },
      ],
    });

    const data = JSON.parse(completion.choices[0].message.content);
    const issues = (Array.isArray(data.issues) ? data.issues : [])
      .filter((i) => Number.isInteger(i.line) && typeof i.message === "string")
      .slice(0, 2);
    res.json({ issues });
  } catch (err) {
    res.json({ issues: [] }); // never break typing because of AI errors
  }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

export default app;