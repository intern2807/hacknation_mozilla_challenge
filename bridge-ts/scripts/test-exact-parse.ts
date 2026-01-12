import { parseToolCallFromText } from '../src/chat/tool-call-parser.js';

// Test with the exact format from the screenshot
const content = '{"name":"r-gmail-mcp-server__search_emails", "parameters": {"query": "from:emma.p.brunskill@gmail.com"}}';

console.log('Testing exact format from screenshot:\n');
console.log(`Content: ${content}\n`);

// Simulate what toolMapping would look like with connected servers
const toolMapping = {
  'r-gmail-mcp-server__search_emails': 'r-gmail-mcp-server',
  'r-gmail-mcp-server__read_email': 'r-gmail-mcp-server',
  'r-gmail-mcp-server__list_email_labels': 'r-gmail-mcp-server',
};

console.log('Tool mapping:', Object.keys(toolMapping).join(', '), '\n');

const result = parseToolCallFromText(content, toolMapping);

if (result) {
  console.log('✓ PARSED:');
  console.log(`  Name: ${result.name}`);
  console.log(`  Args: ${JSON.stringify(result.arguments)}`);
} else {
  console.log('✗ FAILED TO PARSE');
}
