import { Groq } from 'groq-sdk';
import Research from './research';
import { z } from 'zod'; // Recommended for schema validation

// 1. Define the Expected Schema
const ProjectSchema = z.object({
  projectFiles: z.array(z.object({
    name: z.string().min(1),
    content: z.string()
  }))
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `
You are Kimi, a specialized Node js  agent. 
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
- Ensure all dependencies are handled.
`;

/**
 * Generates Node js  code based on a prompt and researched context.
 * @param {string} prompt - The user's coding requirement.
 * @returns {Promise<Object>} - Validated JSON object with project files.
 */
export default async function CodeGenerationNode(prompt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY environment variable.");
  }

  if (!prompt || typeof prompt !== 'string') {
    throw new Error("A valid string prompt is required.");
  }

  try {
    // 2. Execute Research with a timeout or error boundary
    const research = await Research(prompt).catch(err => {
      console.error("Research Phase Failed:", err);
      return "No specific research context available.";
    });

    // 3. Call the LLM
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `RESEARCH/CONTEXT: ${research}\n\nTASK: ${prompt}`
        },
      ],
      model: "moonshotai/kimi-k2-instruct-0905",
      temperature: 0.2, // Lower temperature for more stable JSON in production
      max_completion_tokens: 9000,
      response_format: { type: "json_object" },
    });

    const rawContent = chatCompletion.choices[0]?.message?.content;

    if (!rawContent) {
      throw new Error("LLM returned an empty response.");
    }

    // 4. Parse and Validate Schema
    const parsedData = JSON.parse(rawContent);
    const validatedData = ProjectSchema.safeParse(parsedData);

    if (!validatedData.success) {
      console.error("Schema Validation Error:", validatedData.error);
      throw new Error("AI output did not match the required project schema.");
    }

    return validatedData.data;

  } catch (error) {
    // 5. Centralized Error Logging
    console.error(`Error in CodeGeneration [Prompt: ${prompt.substring(0, 50)}...]:`, error);
    
    // In production, you might want to return a standardized error object
    return {
      error: true,
      message: error.message || "An internal error occurred during code generation."
    };
  }
}
