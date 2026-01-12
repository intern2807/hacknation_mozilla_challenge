import { completion, type CompletionRequest } from '../src/any-llm-ts/src/index.js';

/**
 * Test that simulates the full Harbor orchestrator flow:
 * 1. Build system prompt like orchestrator does
 * 2. Convert tools like AnyLLMAdapter does
 * 3. Call Ollama
 */
async function testHarborFlow() {
  // Simulate buildSystemPrompt for native tool calling providers
  const nativeToolCallingProviders = ['openai', 'anthropic', 'mistral', 'groq', 'ollama'];
  const provider = 'ollama';
  
  let systemPrompt: string;
  if (nativeToolCallingProviders.includes(provider)) {
    systemPrompt = 'You are a helpful AI assistant with access to tools. When the user asks a question that can be answered using a tool, call the appropriate tool. Do not say you cannot help - use the available tools instead.';
    console.log('Using NATIVE tool calling prompt (short)');
  } else {
    systemPrompt = 'Long prompt with tool list...'; // Won't be used
    console.log('Using manual tool instructions (long)');
  }
  
  console.log('System prompt:', systemPrompt);
  console.log('');
  
  // Tools as they would be converted by AnyLLMAdapter
  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'gmail__search_emails',  // Prefixed like MCP tools
        description: 'Search for emails in Gmail',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function' as const,
      function: {
        name: 'gmail__list_email_labels',
        description: 'List all email labels in Gmail',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function' as const,
      function: {
        name: 'gmail__send_email',
        description: 'Send an email',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body' }
          },
          required: ['to', 'subject', 'body']
        }
      }
    }
  ];
  
  const request: CompletionRequest = {
    model: 'ollama:mistral:7b-instruct',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Search for emails from john@example.com' }
    ],
    tools,
  };

  console.log('Sending request to Ollama...');
  console.log('Tools:', tools.map(t => t.function.name).join(', '));
  console.log('');
  
  const response = await completion(request);
  
  console.log('Response:');
  console.log('  finish_reason:', response.choices[0]?.finish_reason);
  console.log('  tool_calls:', JSON.stringify(response.choices[0]?.message?.tool_calls, null, 2));
  console.log('  content:', response.choices[0]?.message?.content?.substring(0, 300));
}

testHarborFlow().catch(console.error);
