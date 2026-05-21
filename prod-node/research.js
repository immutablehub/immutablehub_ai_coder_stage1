import Groq from "groq-sdk";

const MODEL = "openai/gpt-oss-120b";
const MAX_TOKENS = 8192;
const TIMEOUT_MS = 60_000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `
Your goal: Research the latest stable npm packages and best implementation patterns for the user's task.

REQUIREMENTS:
1. Use the browser_search tool to find CURRENT documentation (2024/2025).
2. Identify specific package names and their latest stable version numbers.
3. Describe the standard implementation flow with concrete examples.
4. Output ONLY plain text. No JSON, no markdown code fences, no URLs.
`.trim();

/**
 * Research npm packages and implementation patterns for a given task.
 * @param {string} task - Description of what needs to be built.
 * @returns {Promise<string>} Plain-text research summary.
 */
export async function research(task) {
  if (!task?.trim()) throw new Error("task must be a non-empty string");
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const completion = await groq.chat.completions.create(
      {
        model: MODEL,
        max_completion_tokens: MAX_TOKENS,
        temperature: 1,
        top_p: 1,
        stream: false,
        reasoning_effort: "medium",
        tools: [{ type: "browser_search" }],
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Task: ${task.trim()}` },
        ],
      },
      { signal: controller.signal }
    );

    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from model");

    return content;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Research timed out after ${TIMEOUT_MS / 1000}s`);
    // Re-throw Groq API errors with a clean message
    if (err.status) throw new Error(`Groq API error ${err.status}: ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
