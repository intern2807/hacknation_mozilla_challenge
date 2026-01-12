import { getLLMManager } from '../src/llm/manager.js';

async function main() {
  console.log('Testing Ollama tool calling with improved prompt...\n');
  
  const llm = getLLMManager();
  
  // Detect providers
  console.log('1. Detecting providers...');
  const providers = await llm.detectAll();
  
  const ollama = providers.find(p => p.id === 'ollama');
  if (!ollama?.available) {
    console.log('   ERROR: Ollama not available');
    process.exit(1);
  }
  
  // Set active - use llama3.2 if available
  const llama32 = ollama.models?.find(m => m.id.includes('llama3.2'));
  const model = llama32?.id || ollama.models?.[0]?.id;
  if (!model) {
    console.log('   ERROR: No models available');
    process.exit(1);
  }
  
  llm.setActive('ollama', model);
  console.log(`   Active: ${llm.getActiveId()} / ${llm.getActiveModelId()}\n`);
  
  // More realistic tool set like Gmail MCP server
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
    {
      name: 'list_email_labels',
      description: 'List all labels/folders in the mailbox. Use only when user asks to see all labels.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
  
  console.log('2. Testing with email tools...');
  console.log(`   Tools: ${tools.map(t => t.name).join(', ')}\n`);
  
  const prompt = 'What is the last email that emma@example.com sent me?';
  console.log(`   Prompt: "${prompt}"\n`);
  
  // Updated system prompt
  const systemPrompt = `You are a helpful AI assistant with access to tools.

IMPORTANT RULES:
1. To find emails/items from a person or matching criteria, use SEARCH tools first (e.g., search_emails)
2. Only use read/get tools when you already have a specific ID from a previous search
3. NEVER make up IDs or use placeholder values like "None" - if you don't have an ID, search first
4. When asked "what is the last email from X", use search_emails with from:X as the query

Call the appropriate tool to help the user.`;
  
  console.log('3. Calling LLM...');
  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
    tools,
    systemPrompt,
  });
  
  console.log('\n4. Response:');
  console.log(`   Finish reason: ${response.finishReason}`);
  console.log(`   Content: ${response.message.content?.substring(0, 200) || '(none)'}`);
  console.log(`   Tool calls: ${response.message.toolCalls?.length || 0}`);
  if (response.message.toolCalls?.length) {
    for (const tc of response.message.toolCalls) {
      console.log(`     - ${tc.name}(${JSON.stringify(tc.arguments)})`);
      
      // Check if it's using the right tool
      if (tc.name === 'search_emails') {
        console.log('   ✓ CORRECT: Using search_emails first!');
      } else if (tc.name === 'read_email' && tc.arguments?.messageId === 'None') {
        console.log('   ✗ WRONG: Using read_email with fake ID');
      } else if (tc.name === 'read_email') {
        console.log('   ? QUESTIONABLE: Using read_email without searching first');
      }
    }
  } else {
    console.log('   ✗ FAILED: No tool calls returned');
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
