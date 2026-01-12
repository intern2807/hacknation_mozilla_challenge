import { getLLMManager } from '../src/llm/manager.js';

async function main() {
  console.log('Testing Mistral with improved step-by-step prompt...\n');
  
  const llm = getLLMManager();
  const providers = await llm.detectAll();
  const ollama = providers.find(p => p.id === 'ollama');
  const mistral = ollama?.models?.find(m => m.id.includes('mistral'));
  
  if (!mistral) {
    console.log('ERROR: mistral model not found');
    process.exit(1);
  }
  
  llm.setActive('ollama', mistral.id);
  console.log(`Active: ${llm.getActiveId()} / ${llm.getActiveModelId()}\n`);
  
  // Test tools with full details
  const toolList = `- search_emails: Search for emails by keyword, sender, or criteria. Returns list with IDs.
  Parameters: query (required): Gmail search query (e.g., "from:user@example.com")
- read_email: Read a specific email by message ID. You must have the ID from a search.
  Parameters: messageId (required): The message ID from search results`;

  const systemPrompt = `You are a helpful assistant with access to tools.

## Available Tools
${toolList}

## How Tool Calling Works
1. You call ONE tool at a time
2. You will receive the result back
3. Then you can call another tool OR give a final answer

## CRITICAL: One Step at a Time
- First step: SEARCH to find items (you'll get IDs back)
- Second step: READ/GET a specific item using an ID from the search results
- NEVER make up IDs - you must get them from a search first

## Example Workflow
User: "What is the last email from bob@example.com?"
Step 1: Call search_emails with query "from:bob@example.com"
  → You'll receive a list of emails with IDs
Step 2: Call read_email with the messageId from step 1
  → You'll get the full email content

## Tool Call Format
Respond with ONLY this JSON (no other text):
{"name": "tool_name", "parameters": {"key": "value"}}

## Rules
- Call SEARCH tools first to find items
- Only call READ/GET tools with real IDs from previous results
- One tool call per response - you'll get results back before the next step`;

  const prompt = 'What is the last email that emma@example.com sent me?';
  console.log(`Prompt: "${prompt}"\n`);
  console.log('Calling LLM...\n');

  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
    tools: [],  // Text-based, not native
    systemPrompt,
  });
  
  console.log('Response:');
  console.log(`  Finish reason: ${response.finishReason}`);
  console.log(`  Content: ${response.message.content}\n`);
  
  // Check if it called search first
  const content = response.message.content || '';
  if (content.includes('search_emails') && !content.includes('read_email')) {
    console.log('✓ CORRECT: Called search_emails first (not read_email)');
  } else if (content.includes('read_email') && !content.includes('search_emails')) {
    console.log('✗ WRONG: Tried to call read_email without searching first');
  } else {
    console.log('? Check the response manually');
  }
  
  // Try to parse
  const { parseToolCallFromText } = await import('../src/chat/tool-call-parser.js');
  const toolMapping = { 'search_emails': 'test', 'read_email': 'test' };
  const parsed = parseToolCallFromText(content, toolMapping);
  
  if (parsed) {
    console.log(`\nParsed tool call: ${parsed.name}(${JSON.stringify(parsed.arguments)})`);
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
