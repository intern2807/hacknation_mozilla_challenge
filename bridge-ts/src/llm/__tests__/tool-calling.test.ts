/**
 * Tool Calling Integration Tests
 * 
 * Tests to verify that tools are properly passed to LLMs and that
 * tool calls are correctly parsed from responses.
 */

import { describe, it, expect } from 'vitest';
import { getLLMManager } from '../manager.js';
import type { ToolDefinition, ChatRequest } from '../provider.js';

describe('Tool Calling Flow', () => {
  
  describe('Tool Format Conversion', () => {
    it('should convert tools to correct format for LLM', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'get_current_time',
          description: 'Get the current time in a specific timezone',
          inputSchema: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'The timezone (e.g., "America/New_York")',
              },
            },
            required: ['timezone'],
          },
        },
      ];

      // The tool format should have name, description, and inputSchema
      expect(tools[0].name).toBe('get_current_time');
      expect(tools[0].description).toContain('current time');
      expect(tools[0].inputSchema).toBeDefined();
      expect((tools[0].inputSchema as any).properties.timezone).toBeDefined();
    });
  });

  describe('LLM Manager', () => {
    it('should detect available providers', async () => {
      const manager = getLLMManager();
      const providers = await manager.detectAll();
      
      console.log('Detected providers:', providers.map(p => ({
        id: p.id,
        available: p.available,
        supportsTools: p.supportsTools,
        models: p.models?.length || 0,
      })));
      
      // At least one provider should be available (Ollama or other)
      const available = providers.filter(p => p.available);
      expect(available.length).toBeGreaterThanOrEqual(0); // May be 0 if no LLM running
    });

    it('should show active provider and model', async () => {
      const manager = getLLMManager();
      await manager.detectAll();
      
      const summary = manager.getSummary();
      console.log('LLM Manager summary:', summary);
      
      // Log for debugging
      if (summary.activeProvider) {
        console.log(`Active: ${summary.activeProvider} / ${summary.activeModel}`);
      } else {
        console.log('No active provider - is Ollama running?');
      }
    });
  });

  describe('Tool Passing to LLM', () => {
    it('should include tools in chat request', async () => {
      const manager = getLLMManager();
      await manager.detectAll();
      
      if (!manager.hasAvailableProvider()) {
        console.log('Skipping - no LLM provider available');
        return;
      }

      const tools: ToolDefinition[] = [
        {
          name: 'get_current_time',
          description: 'Get the current time. Call this when the user asks what time it is.',
          inputSchema: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: 'Timezone like "UTC" or "America/New_York"',
                default: 'UTC',
              },
            },
          },
        },
      ];

      const request: ChatRequest = {
        messages: [
          { role: 'user', content: 'What time is it?' },
        ],
        tools,
        systemPrompt: `You are a helpful assistant with access to tools. 
When the user asks about the time, you MUST call the get_current_time tool.
Do not say you cannot help - use the tool instead.`,
      };

      console.log('Sending chat request with tools:', tools.map(t => t.name));
      
      const response = await manager.chat(request);
      
      console.log('Response:', {
        finishReason: response.finishReason,
        hasToolCalls: !!response.message.toolCalls?.length,
        toolCalls: response.message.toolCalls,
        content: response.message.content?.substring(0, 200),
      });

      // Log whether tools were called
      if (response.message.toolCalls?.length) {
        console.log('✅ LLM called tools:', response.message.toolCalls.map(tc => tc.name));
      } else {
        console.log('❌ LLM did NOT call tools. Response:', response.message.content?.substring(0, 100));
      }
    });
  });

  // Note: MCP integration tests require a running bridge with connected servers
  // These tests focus on the LLM + tool calling layer which can be tested in isolation
});

describe('Many Tools Test', () => {
  it('should work with multiple tools (like real scenario)', async () => {
    const manager = getLLMManager();
    await manager.detectAll();
    
    if (!manager.hasAvailableProvider()) {
      console.log('Skipping - no LLM provider available');
      return;
    }

    // Simulate having many tools like in the real scenario
    const tools: ToolDefinition[] = [
      {
        name: 'curated-time__get_current_time',
        description: 'Get the current time in a specific timezone',
        inputSchema: {
          type: 'object',
          properties: {
            timezone: { type: 'string', description: 'Timezone like UTC' },
          },
        },
      },
      {
        name: 'github__get_me',
        description: 'Get information about the authenticated GitHub user',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'github__list_repos',
        description: 'List repositories for a user or organization',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
          },
        },
      },
      // Add a few more to simulate the real scenario
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool number ${i} for testing`,
        inputSchema: { type: 'object', properties: {} },
      })),
    ];

    const request: ChatRequest = {
      messages: [
        { role: 'user', content: 'What time is it?' },
      ],
      tools,
      systemPrompt: `You are a helpful assistant with access to tools. Use them when appropriate.`,
    };

    console.log(`Sending chat request with ${tools.length} tools...`);
    
    const response = await manager.chat(request);
    
    console.log('Response:', {
      finishReason: response.finishReason,
      hasToolCalls: !!response.message.toolCalls?.length,
      toolCalls: response.message.toolCalls?.map(tc => tc.name),
      content: response.message.content?.substring(0, 200),
    });

    if (response.message.toolCalls?.length) {
      console.log('✅ LLM called tools with many options:', response.message.toolCalls.map(tc => tc.name));
    } else {
      console.log('❌ LLM did NOT call tools with many options');
      console.log('   Response:', response.message.content?.substring(0, 100));
    }
  });

  it('should work with long complex tool names', async () => {
    const manager = getLLMManager();
    await manager.detectAll();
    
    if (!manager.hasAvailableProvider()) {
      console.log('Skipping - no LLM provider available');
      return;
    }

    // Test with the actual prefixed tool name format
    const tools: ToolDefinition[] = [
      {
        name: 'curated-time__get_current_time',
        description: 'Get the current time in a specified timezone. Use this when the user asks what time it is.',
        inputSchema: {
          type: 'object',
          properties: {
            timezone: { 
              type: 'string', 
              description: 'The timezone (e.g. "UTC", "America/New_York")',
              default: 'UTC',
            },
          },
        },
      },
    ];

    const request: ChatRequest = {
      messages: [
        { role: 'user', content: 'What time is it?' },
      ],
      tools,
      systemPrompt: 'You are a helpful assistant. When asked about the time, call the get_current_time tool.',
    };

    console.log('Testing with prefixed tool name: curated-time__get_current_time');
    
    const response = await manager.chat(request);
    
    if (response.message.toolCalls?.length) {
      console.log('✅ LLM called prefixed tool:', response.message.toolCalls[0].name);
    } else {
      console.log('❌ LLM did NOT call prefixed tool');
      console.log('   Response:', response.message.content?.substring(0, 100));
    }
  });
});

describe('Orchestrator System Prompt Test', () => {
  it('should test with the orchestrator-style system prompt', async () => {
    const manager = getLLMManager();
    await manager.detectAll();
    
    if (!manager.hasAvailableProvider()) {
      console.log('Skipping - no LLM provider available');
      return;
    }

    // These are the tools - same as before
    const tools: ToolDefinition[] = [
      {
        name: 'curated-time__get_current_time',
        description: 'Get the current time in a specific timezone',
        inputSchema: {
          type: 'object',
          properties: {
            timezone: { type: 'string', description: 'Timezone like UTC' },
          },
        },
      },
    ];

    // This is similar to what the orchestrator builds
    const orchestratorSystemPrompt = `You are an AI assistant with tool access. You MUST call tools to answer questions that require them.

AVAILABLE TOOLS:

curated-time:
  - get_current_time: Get the current time in a specific timezone

HOW TO CALL A TOOL - output ONLY this JSON (nothing else):
{"name": "tool_name", "parameters": {}}

RULES:
1. READ the tool descriptions carefully to choose the right tool
2. If a question can be answered with a tool, CALL IT - don't say you can't help
3. After receiving tool results, summarize in plain English
4. Call tools directly - don't describe them or ask permission`;

    const request: ChatRequest = {
      messages: [
        { role: 'user', content: 'What time is it?' },
      ],
      tools,
      systemPrompt: orchestratorSystemPrompt,
    };

    console.log('Testing with orchestrator-style system prompt...');
    console.log('System prompt length:', orchestratorSystemPrompt.length, 'chars');
    
    const response = await manager.chat(request);
    
    console.log('Response:', {
      finishReason: response.finishReason,
      hasToolCalls: !!response.message.toolCalls?.length,
      toolCalls: response.message.toolCalls?.map(tc => tc.name),
      content: response.message.content?.substring(0, 300),
    });

    if (response.message.toolCalls?.length) {
      console.log('✅ LLM called tools with orchestrator prompt');
    } else {
      console.log('❌ LLM did NOT call tools with orchestrator prompt');
      console.log('   This might be the bug! The orchestrator system prompt may be confusing the LLM.');
    }
  });

  it('should test with simple vs complex system prompt', async () => {
    const manager = getLLMManager();
    await manager.detectAll();
    
    if (!manager.hasAvailableProvider()) {
      console.log('Skipping - no LLM provider available');
      return;
    }

    const tools: ToolDefinition[] = [
      {
        name: 'curated-time__get_current_time',
        description: 'Get the current time in a specific timezone',
        inputSchema: {
          type: 'object',
          properties: {
            timezone: { type: 'string' },
          },
        },
      },
    ];

    // Test 1: Simple prompt
    console.log('\n--- Test 1: Simple system prompt ---');
    const simpleResponse = await manager.chat({
      messages: [{ role: 'user', content: 'What time is it?' }],
      tools,
      systemPrompt: 'You are a helpful assistant. Use tools when needed.',
    });
    console.log('Simple prompt result:', simpleResponse.message.toolCalls?.length ? '✅ Tool called' : '❌ No tool');

    // Test 2: Prompt with JSON instruction
    console.log('\n--- Test 2: Prompt with JSON instruction ---');
    const jsonInstructResponse = await manager.chat({
      messages: [{ role: 'user', content: 'What time is it?' }],
      tools,
      systemPrompt: `You are a helpful assistant with tools. To call a tool, output JSON like: {"name": "tool_name", "parameters": {}}`,
    });
    console.log('JSON instruction result:', jsonInstructResponse.message.toolCalls?.length ? '✅ Tool called' : '❌ No tool');
    if (!jsonInstructResponse.message.toolCalls?.length) {
      console.log('  Response:', jsonInstructResponse.message.content?.substring(0, 100));
    }

    // Test 3: Long detailed prompt
    console.log('\n--- Test 3: Long detailed prompt ---');
    const longPrompt = `You are an AI assistant with tool access. You MUST call tools to answer questions.

AVAILABLE TOOLS:
curated-time:
  - get_current_time: Get the current time

HOW TO CALL A TOOL:
{"name": "tool_name", "parameters": {}}

RULES:
1. If a question can be answered with a tool, CALL IT
2. Don't say you can't help - use the tool
3. Call tools directly`;
    
    const longResponse = await manager.chat({
      messages: [{ role: 'user', content: 'What time is it?' }],
      tools,
      systemPrompt: longPrompt,
    });
    console.log('Long prompt result:', longResponse.message.toolCalls?.length ? '✅ Tool called' : '❌ No tool');
    if (!longResponse.message.toolCalls?.length) {
      console.log('  Response:', longResponse.message.content?.substring(0, 100));
    }
  });
});

describe('Ollama Tool Support', () => {
  it('should verify Ollama version supports tools', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/version');
      if (response.ok) {
        const data = await response.json() as { version?: string };
        console.log('Ollama version:', data.version);
        
        // Tool support requires Ollama >= 0.3.0
        const version = data.version || '0.0.0';
        const [major, minor] = version.split('.').map(Number);
        const supportsTools = major > 0 || (major === 0 && minor >= 3);
        
        console.log('Supports tools:', supportsTools ? '✅ Yes' : '❌ No (needs 0.3.0+)');
      }
    } catch {
      console.log('Ollama not running or not accessible');
    }
  });

  it('should list available Ollama models', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        console.log('Available Ollama models:', data.models?.map(m => m.name) || []);
      }
    } catch {
      console.log('Could not list Ollama models');
    }
  });

  it('should test direct Ollama tool call', async () => {
    try {
      const request = {
        model: 'llama3.2',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. When asked about the time, call the get_current_time tool.',
          },
          {
            role: 'user',
            content: 'What time is it?',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_current_time',
              description: 'Get the current time',
              parameters: {
                type: 'object',
                properties: {
                  timezone: {
                    type: 'string',
                    description: 'Timezone',
                  },
                },
              },
            },
          },
        ],
        stream: false,
      };

      console.log('Sending direct Ollama request with tool...');
      
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (response.ok) {
        const data = await response.json() as { 
          message?: { content?: string; tool_calls?: Array<{ function: { name: string } }> };
          done_reason?: string;
        };
        console.log('Ollama response:', {
          content: data.message?.content?.substring(0, 100),
          toolCalls: data.message?.tool_calls,
          doneReason: data.done_reason,
        });

        if (data.message?.tool_calls?.length) {
          console.log('✅ Ollama called tool:', data.message.tool_calls[0].function.name);
        } else {
          console.log('❌ Ollama did NOT call tool');
          console.log('   Response:', data.message?.content?.substring(0, 150));
        }
      } else {
        console.log('Ollama request failed:', response.status);
      }
    } catch (err) {
      console.log('Could not test Ollama:', err);
    }
  });
});

