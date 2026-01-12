/**
 * Tool Call Parser Tests
 * 
 * These tests ensure text-based tool calling works correctly for models
 * that don't support native tool calling (like mistral:7b-instruct).
 */

import { describe, it, expect } from 'vitest';
import {
  parseToolCallFromText,
  tryParseNameFormat,
  tryParsePythonFunctionFormat,
  tryParseKeyValueFormat,
  tryParseFunctionCallFormat,
  cleanLLMTokens,
  extractFromCodeBlock,
} from '../tool-call-parser.js';

// Standard tool mapping for tests
const toolMapping = {
  'r-gmail-mcp-server__search_emails': 'r-gmail-mcp-server',
  'r-gmail-mcp-server__read_email': 'r-gmail-mcp-server',
  'r-gmail-mcp-server__list_email_labels': 'r-gmail-mcp-server',
  'search_emails': 'test-server',
  'read_email': 'test-server',
};

describe('Tool Call Parser', () => {
  describe('JSON name format', () => {
    it('parses standard JSON format with exact tool name', () => {
      const content = '{"name": "search_emails", "parameters": {"query": "from:test@example.com"}}';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.name).toBe('search_emails');
      expect(result!.arguments).toEqual({ query: 'from:test@example.com' });
    });

    it('parses JSON with server-prefixed tool name', () => {
      const content = '{"name":"r-gmail-mcp-server__search_emails", "parameters": {"query": "from:emma@gmail.com"}}';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.name).toBe('r-gmail-mcp-server__search_emails');
      expect(result!.arguments).toEqual({ query: 'from:emma@gmail.com' });
    });

    it('parses JSON with whitespace variations', () => {
      const content = `{
        "name": "search_emails",
        "parameters": {
          "query": "subject:meeting"
        }
      }`;
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.name).toBe('search_emails');
    });

    it('handles "arguments" instead of "parameters"', () => {
      const content = '{"name": "search_emails", "arguments": {"query": "test"}}';
      const result = tryParseNameFormat(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.arguments).toEqual({ query: 'test' });
    });
  });

  describe('Python function format', () => {
    it('parses Python-style function call with single quotes', () => {
      const content = "search_emails(query='from:test@example.com')";
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      // Parser finds server-prefixed version since it's also in mapping
      expect(result!.name).toMatch(/search_emails$/);
      expect(result!.arguments).toEqual({ query: 'from:test@example.com' });
    });

    it('parses Python-style with server prefix and underscores', () => {
      // Models sometimes output underscores instead of hyphens
      const content = "r_gmail_mcp_server__search_emails(query='from:emma@gmail.com')";
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.name).toBe('r-gmail-mcp-server__search_emails');
    });

    it('parses Python code block from Mistral output', () => {
      const content = `To find the last email, I'll use the search_emails function:

\`\`\`python
results = r_gmail_mcp_server__search_emails(query='from:emma@example.com')
print(results)
\`\`\``;
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.name).toBe('r-gmail-mcp-server__search_emails');
      expect(result!.arguments).toEqual({ query: 'from:emma@example.com' });
    });

    it('parses multiple Python kwargs', () => {
      const content = "search_emails(query='from:test@example.com', maxResults=10)";
      const result = tryParsePythonFunctionFormat(content, ['search_emails'], toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.arguments).toHaveProperty('query', 'from:test@example.com');
      expect(result!.arguments).toHaveProperty('maxResults', 10);
    });
  });

  describe('Code block extraction', () => {
    it('extracts content from json code block', () => {
      const content = '```json\n{"name": "test"}\n```';
      const extracted = extractFromCodeBlock(content);
      expect(extracted).toBe('{"name": "test"}');
    });

    it('extracts content from plain code block', () => {
      const content = '```\n{"name": "test"}\n```';
      const extracted = extractFromCodeBlock(content);
      expect(extracted).toBe('{"name": "test"}');
    });

    it('returns original content if no code block', () => {
      const content = '{"name": "test"}';
      const extracted = extractFromCodeBlock(content);
      expect(extracted).toBe('{"name": "test"}');
    });
  });

  describe('LLM token cleaning', () => {
    it('removes common LLM special tokens', () => {
      const content = '<|eot_id|>{"name": "test"}<|end_of_text|>';
      const cleaned = cleanLLMTokens(content);
      expect(cleaned).toBe('{"name": "test"}');
    });

    it('removes llama tokens', () => {
      const content = '</s>{"name": "test"}<s>';
      const cleaned = cleanLLMTokens(content);
      expect(cleaned).toBe('{"name": "test"}');
    });
  });

  describe('Tool name matching', () => {
    it('matches short name to prefixed name', () => {
      const content = '{"name": "search_emails", "parameters": {}}';
      // Even though we ask for "search_emails", if the mapping has both,
      // it should find a match
      const result = parseToolCallFromText(content, {
        'server__search_emails': 'server',
        'search_emails': 'server2',
      });
      
      expect(result).not.toBeNull();
    });

    it('returns null for unknown tool', () => {
      const content = '{"name": "unknown_tool", "parameters": {}}';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('handles empty parameters', () => {
      const content = '{"name": "search_emails", "parameters": {}}';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.arguments).toEqual({});
    });

    it('handles missing parameters field', () => {
      const content = '{"name": "search_emails"}';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).not.toBeNull();
      expect(result!.arguments).toEqual({});
    });

    it('returns null for non-tool JSON', () => {
      const content = '{"error": "something went wrong"}';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).toBeNull();
    });

    it('returns null for plain text', () => {
      const content = 'I cannot help with that request.';
      const result = parseToolCallFromText(content, toolMapping);
      
      expect(result).toBeNull();
    });
  });
});

describe('Regression tests for Mistral 7B', () => {
  // These are based on actual outputs we've seen from mistral:7b-instruct
  
  it('parses the exact format Mistral outputs', () => {
    const content = ' {"name": "search_emails", "parameters": {"query": "from:emma@example.com"}}';
    const result = parseToolCallFromText(content, toolMapping);
    
    expect(result).not.toBeNull();
    expect(result!.name).toBe('search_emails');
    expect(result!.arguments.query).toBe('from:emma@example.com');
  });

  it('parses Mistral output with server prefix', () => {
    const content = '{"name":"r-gmail-mcp-server__search_emails", "parameters": {"query": "from:emma.p.brunskill@gmail.com"}}';
    const result = parseToolCallFromText(content, toolMapping);
    
    expect(result).not.toBeNull();
    expect(result!.name).toBe('r-gmail-mcp-server__search_emails');
  });

  it('does NOT produce placeholders like [your_email]', () => {
    // This is a test for prompt quality - the parser should not receive these
    // But if it does, it should still parse the tool name correctly
    const content = '{"name": "search_emails", "parameters": {"query": "from:test@example.com to:[your_email]"}}';
    const result = parseToolCallFromText(content, toolMapping);
    
    expect(result).not.toBeNull();
    // The parser will parse it, but the query contains a placeholder
    // This test documents the behavior - the prompt should prevent this
    expect(result!.arguments.query).toContain('[your_email]');
  });
});
