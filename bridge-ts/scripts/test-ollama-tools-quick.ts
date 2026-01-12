import { completion, type CompletionRequest } from '../src/any-llm-ts/src/index.js';

async function testOllamaTools() {
  const request: CompletionRequest = {
    model: 'ollama:mistral:7b-instruct',
    messages: [
      { role: 'user', content: 'Search for emails from John' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'search_emails',
          description: 'Search for emails matching criteria',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              from: { type: 'string', description: 'Sender email' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_emails',
          description: 'List all emails',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      }
    ]
  };

  console.log('Sending request to Ollama...');
  console.log('Tools:', request.tools?.map(t => t.function.name).join(', '));
  
  const response = await completion(request);
  
  console.log('\nResponse:');
  console.log('  finish_reason:', response.choices[0]?.finish_reason);
  console.log('  tool_calls:', JSON.stringify(response.choices[0]?.message?.tool_calls, null, 2));
  console.log('  content:', response.choices[0]?.message?.content?.substring(0, 300));
}

testOllamaTools().catch(console.error);
