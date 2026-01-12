import { getLLMManager } from '../src/llm/manager.js';
import { getChatOrchestrator } from '../src/chat/orchestrator.js';
import { createSession } from '../src/chat/session.js';

async function main() {
  console.log('Testing Orchestrator with Mistral 7B (text-based tools)...\n');
  
  const llm = getLLMManager();
  
  // Detect providers and set to mistral
  console.log('1. Setting up LLM...');
  const providers = await llm.detectAll();
  const ollama = providers.find(p => p.id === 'ollama');
  const mistral = ollama?.models?.find(m => m.id.includes('mistral'));
  
  if (!mistral) {
    console.log('   ERROR: mistral model not found');
    process.exit(1);
  }
  
  llm.setActive('ollama', mistral.id);
  console.log(`   Active: ${llm.getActiveId()} / ${llm.getActiveModelId()}\n`);
  
  // Create mock tools (as if MCP server provided them)
  const mockTools = [
    {
      name: 'test-server__search_emails',
      description: 'Search for emails by keyword, sender, subject, or other criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g., "from:user@example.com")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'test-server__read_email',
      description: 'Read a specific email by its message ID.',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The unique message ID' },
        },
        required: ['messageId'],
      },
    },
  ];
  
  // Create orchestrator
  const orchestrator = getChatOrchestrator();
  
  // Override tool collection to return our mock tools
  (orchestrator as any).collectEnabledTools = async () => mockTools;
  
  // Create session
  const session = createSession({
    maxIterations: 3,
    enabledServers: ['test-server'],
  });
  
  console.log('2. Testing orchestration...');
  const prompt = 'What is the last email that emma@example.com sent me?';
  console.log(`   Prompt: "${prompt}"\n`);
  
  // Run orchestration
  const result = await orchestrator.run(session, prompt, (step) => {
    console.log(`   Step ${step.index}: ${step.type}`);
    if (step.type === 'tool_calls' && step.toolCalls) {
      for (const tc of step.toolCalls) {
        console.log(`      - ${tc.name}(${JSON.stringify(tc.arguments)})`);
      }
    }
  });
  
  console.log('\n3. Result:');
  console.log(`   Iterations: ${result.iterations}`);
  console.log(`   Duration: ${result.durationMs}ms`);
  console.log(`   Final response: ${result.finalResponse?.substring(0, 200)}`);
  
  // Check if it used search_emails
  const usedSearch = result.steps.some(s => 
    s.type === 'tool_calls' && 
    s.toolCalls?.some(tc => tc.name.includes('search'))
  );
  
  if (usedSearch) {
    console.log('\n   ✓ SUCCESS: Used search_emails tool!');
  } else {
    console.log('\n   ✗ FAILED: Did not use search tool');
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
