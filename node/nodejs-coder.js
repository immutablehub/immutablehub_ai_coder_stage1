import { Groq } from 'groq-sdk';
import Research from './research';
const groq = new Groq({
    apiKey:process.env.GROQ_API_KEY
});



const SYSTEMPROMPT = `
You are Kimi, a specialized Node.js agent. 
Output ONLY a JSON object. No markdown, no preamble.

### CONTEXT GROUNDING
A "RESEARCH/CONTEXT" block will be provided in the user message. 
1. You MUST use the specific library versions found in that context.
2. Follow the architectural patterns or best practices described in that context.
3. If the context specifies a certain API or tool, prioritize it over your general knowledge.

### OUTPUT SCHEMA
{
  "projectFiles": [
    { "name": "filename.js", "content": "source_code" }
  ]
}

### RULES
- No folders. Flat file structure only.
- Use ES Modules (import/export).
- Ensure "projectFiles" contains everything needed to run the task.

`




export default async function CodeGeneration(prompt){




    let research=await Research(prompt)

    const chatCompletion = await groq.chat.completions.create({
            messages: [
                {"role": "system", "content":SYSTEMPROMPT},
                {"role": "user","content":`

                    RESEARCH/CONTEXT:${research}
                    TASK:
                   ${prompt}
                `},
                ],
            model:"moonshotai/kimi-k2-instruct-0905",
            temperature: 0.6,
            max_completion_tokens: 9000,
            frequency_penalty:0.8,
            top_p: 1,
            stream: false,
            response_format: {
              type: "json_object"
            },
            stop: null
            })

        return chatCompletion.choices[0].message.content
}
