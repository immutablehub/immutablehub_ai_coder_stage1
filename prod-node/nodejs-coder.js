import { Groq } from 'groq-sdk';
import { z } from 'zod';
import Research from './research.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL = 'moonshotai/kimi-k2-instruct-0905';
const MAX_TOKENS = 9000;
const TEMPERATURE = 0.2;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const SYSTEM_PROMPT = `You are Kimi, a specialized Node.js agent.
Output ONLY a JSON object. No markdown, no preamble.

### CONTEXT GROUNDING
A "RESEARCH/CONTEXT" block will be provided.
1. Use specific library versions found in context.
2. Follow architectural patterns described.
3. Prioritize context-specified tools over general knowledge.

### OUTPUT SCHEMA
{
  "projectFiles": [
    { "name": "filename.js", "content": "source_code" }
  ]
}

### RULES
- No folders. Flat file structure only.
- Use ES Modules (import/export).
- Ensure all dependencies are handled.`;

// ─── Schema ───────────────────────────────────────────────────────────────────

const ProjectFileSchema = z.object({
  name: z.string().min(1, 'File name cannot be empty'),
  content: z.string(),
});

const ProjectSchema = z.object({
  projectFiles: z
    .array(ProjectFileSchema)
    .min(1, 'At least one project file is required'),
});

// ─── Errors ───────────────────────────────────────────────────────────────────

class CodeGenError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CodeGenError';
    this.cause = cause ?? null;
  }
}

class SchemaValidationError extends CodeGenError {
  constructor(issues) {
    super('AI output did not match the required project schema.');
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new CodeGenError('Missing GROQ_API_KEY environment variable.');
  return new Groq({ apiKey });
}

async function fetchResearchContext(prompt) {
  try {
    const context = await Research(prompt);
    return context ?? 'No specific research context available.';
  } catch (err) {
    // Non-fatal: log and continue without research context
    console.warn('[CodeGen] Research phase failed — continuing without context.', {
      error: err?.message,
    });
    return 'No specific research context available.';
  }
}

async function callLLM(groq, { systemPrompt, researchContext, userPrompt }, attempt = 1) {
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_completion_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `RESEARCH/CONTEXT: ${researchContext}\n\nTASK: ${userPrompt}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new CodeGenError('LLM returned an empty response.');
    return raw;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.warn(`[CodeGen] LLM call failed (attempt ${attempt}/${MAX_RETRIES}). Retrying…`, {
        error: err?.message,
      });
      await sleep(RETRY_DELAY_MS * attempt);
      return callLLM(groq, { systemPrompt, researchContext, userPrompt }, attempt + 1);
    }
    throw new CodeGenError('LLM call failed after maximum retries.', err);
  }
}

function parseAndValidate(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CodeGenError('LLM response was not valid JSON.', err);
  }

  const result = ProjectSchema.safeParse(parsed);
  if (!result.success) {
    throw new SchemaValidationError(result.error.issues);
  }
  return result.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates Node.js project files based on a prompt and researched context.
 *
 * @param {string} prompt - The user's coding requirement.
 * @returns {Promise<{ projectFiles: Array<{ name: string; content: string }> }>}
 */
export default async function CodeGenerationNode(prompt) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new TypeError('A non-empty string prompt is required.');
  }

  const groq = createGroqClient();
  const truncated = prompt.substring(0, 60);

  console.info(`[CodeGen] Starting generation.`, { prompt: truncated });

  const researchContext = await fetchResearchContext(prompt);

  const raw = await callLLM(groq, {
    systemPrompt: SYSTEM_PROMPT,
    researchContext,
    userPrompt: prompt,
  });

  const data = parseAndValidate(raw);

  console.info(`[CodeGen] Generation complete.`, {
    fileCount: data.projectFiles.length,
    files: data.projectFiles.map((f) => f.name),
  });

  return data;
}
