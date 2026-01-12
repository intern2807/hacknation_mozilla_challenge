import { getLLMManager } from '../src/llm/manager.js';

async function main() {
  console.log('Testing simplified strategy-focused prompt...\n');
  
  const llm = getLLMManager();
  const providers = await llm.detectAll();
  const ollama = providers.find(p => p.id === 'ollama');
  const mistral = ollama?.models?.find(m => m.id.includes('mistral'));
  
  if (!mistral) {
    console.log('ERROR: mistral model not found');
    process.exit(1);
  }
  
  llm.setActive('ollama', mistral.id);
  console.log(`Active: ${llm.getActiveModelId()}\n`);
  
  const toolList = `- search_emails: Search emails. Returns list with message IDs.
  Parameters: query (required): Search query like "from:user@example.com" or "subject:hello"
- read_email: Read one email by ID.
  Parameters: messageId (required): ID from search results`;

  const systemPrompt = `You are a helpful assistant that can take actions using tools.

## Available Tools
${toolList}

## Strategy
Think step by step. You can make multiple tool calls - each call will return results, then you decide the next action.

1. To find something: SEARCH first. You'll get a list with IDs.
2. To get details: Use the ID from search results to READ/GET.
3. Keep parameters simple. Only include what the user mentioned - no placeholders.

## Response Format  
To call a tool, respond with ONLY valid JSON:
{"name": "tool_name", "parameters": {"param": "value"}}

To give a final answer (after getting results), just respond normally with text.

## Important
- One action at a time. You'll see results before deciding the next step.
- Use only real values from the user's request or from previous results.
- Never use placeholders like [your_email] or [unknown] - omit unknown parameters.`;

  const prompt = 'What is the last email that emma@example.com sent me?';
  console.log(`User: "${prompt}"\n`);

  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt,
  });
  
  console.log(`Response: ${response.message.content}\n`);
  
  // Check the query
  const content = response.message.content || '';
  if (content.includes('[') && content.includes(']')) {
    console.log('✗ BAD: Contains placeholder brackets');
  } else if (content.includes('search_emails')) {
    console.log('✓ Good: Called search_emails');
    
    // Parse and check the query
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const json = JSON.parse(match[0]);
        console.log(`  Query: ${json.parameters?.query}`);
        if (json.parameters?.query && !json.parameters.query.includes('[')) {
          console.log('✓ Good: No placeholders in query');
        }
      }
    } catch {}
  }
}

main().catch(e => console.error('Error:', e));
