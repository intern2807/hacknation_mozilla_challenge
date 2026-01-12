import { getLLMManager } from '../src/llm/manager.js';

async function main() {
  console.log('Testing Mistral 7B with text-based tool calling...\n');
  
  const llm = getLLMManager();
  
  // Detect providers
  console.log('1. Detecting providers...');
  const providers = await llm.detectAll();
  
  const ollama = providers.find(p => p.id === 'ollama');
  if (!ollama?.available) {
    console.log('   ERROR: Ollama not available');
    process.exit(1);
  }
  
  // Set active to mistral:7b-instruct
  const mistral = ollama.models?.find(m => m.id.includes('mistral'));
  if (!mistral) {
    console.log('   ERROR: mistral model not found');
    process.exit(1);
  }
  
  llm.setActive('ollama', mistral.id);
  console.log(`   Active: ${llm.getActiveId()} / ${llm.getActiveModelId()}\n`);
  
  // Test tools
  const tools = [
    {
      name: 'search_emails',
      description: 'Search for emails by keyword, sender, subject, or other criteria. Returns a list of matching emails.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g., "from:user@example.com" or "subject:meeting")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_email',
      description: 'Read a specific email by its message ID. You must have the ID from a previous search.',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The unique message ID of the email to read' },
        },
        required: ['messageId'],
      },
    },
  ];
  
  console.log('2. Testing text-based tool calling...');
  console.log(`   Tools: ${tools.map(t => t.name).join(', ')}\n`);
  
  const prompt = 'What is the last email that emma@example.com sent me?';
  console.log(`   Prompt: "${prompt}"\n`);
  
  // Text-based tool calling prompt (for models without native support)
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  const systemPrompt = `You are a helpful assistant with access to tools.

## Available Tools
${toolList}

## Choosing Between Similar Tools
- **search tools**: Use when user wants to FIND something specific (mentions a name, keyword, date, etc.)
- **read/get tools**: Use to retrieve a specific item by ID (only when you have an ID from a previous search)

CRITICAL: To find emails from a person, use search_emails with from:email as the query. NEVER use read_email without a real ID.

## Tool Call Format
When calling a tool, respond with ONLY this JSON:
{"name": "tool_name", "parameters": {"key": "value"}}

## Rules
- Match the tool name to what the user is asking for
- If a tool can help, call it - don't write code or explain
- Extract parameter values from what the user said`;

  console.log('3. Calling LLM with text-based prompt...');
  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
    tools: [],  // Don't pass tools natively - use prompt-based
    systemPrompt,
  });
  
  console.log('\n4. Response:');
  console.log(`   Finish reason: ${response.finishReason}`);
  console.log(`   Content: ${response.message.content?.substring(0, 500) || '(none)'}`);
  
  // Now test the parser
  console.log('\n5. Testing parser on response...');
  
  const { parseToolCallFromText } = await import('../src/chat/tool-call-parser.js');
  
  const toolMapping: Record<string, string> = {
    'search_emails': 'test-server',
    'read_email': 'test-server',
  };
  
  const parsed = parseToolCallFromText(response.message.content || '', toolMapping);
  
  if (parsed) {
    console.log(`   ✓ PARSED: ${parsed.name}(${JSON.stringify(parsed.arguments)})`);
  } else {
    console.log('   ✗ FAILED to parse tool call from response');
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
