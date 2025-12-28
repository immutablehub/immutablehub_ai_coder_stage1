import { Groq } from 'groq-sdk';

const groq = new Groq({
    apiKey:process.env.GROQ_API_KEY

});

export default async function Research(task) {

    
    const chatCompletion = await groq.chat.completions.create({
            messages: [
                {"role": "system", "content":`

                Your goal: Research the latest stable npm packages and best implementation patterns for the user's task.
                
                REQUIREMENTS:
                1. Use the tool to find CURRENT documentation (2024/2025).
                2. Identify specific package names and their latest version numbers.
                3. Describe the standard implementation flow.
                4. Output ONLY plain text summary. No JSON. No URLs.
                    `},
                     {"role": "user", "content":`
                      Task:${task}
                    `},
                ],
            model:"openai/gpt-oss-120b",
            temperature: 1,
            max_completion_tokens: 8192,
            top_p: 1,
            stream: false,
            reasoning_effort: "medium",
            tools: [{"type": "browser_search"}],
            stop: null
            })

        return chatCompletion.choices[0].message.content


    
}
