import { parseToolCallFromText } from '../src/chat/tool-call-parser.js';

console.log('Testing Python-style tool call parsing...\n');

// Simulate what Mistral outputs
const testCases = [
  {
    name: 'Python function call',
    content: `To find out about the last email Emma P. Brunskill sent to you, I will use the search_emails function:

\`\`\`python
results = r_gmail_mcp_server__search_emails(query='from:emma.p.brunskill@gmail.com newer_than:30d')
print(results)
\`\`\``,
  },
  {
    name: 'JSON format',
    content: '{"name": "search_emails", "parameters": {"query": "from:emma@example.com"}}',
  },
  {
    name: 'Python with to/from',
    content: "r_gmail_mcp_server__search_emails(query='to:emma.p.brunskill@gmail.com')",
  },
];

const toolMapping: Record<string, string> = {
  'r-gmail-mcp-server__search_emails': 'gmail-server',
  'r-gmail-mcp-server__read_email': 'gmail-server',
  'search_emails': 'gmail-server',
  'read_email': 'gmail-server',
};

for (const tc of testCases) {
  console.log(`Test: ${tc.name}`);
  console.log(`  Input: ${tc.content.substring(0, 100)}...`);
  
  const result = parseToolCallFromText(tc.content, toolMapping);
  
  if (result) {
    console.log(`  ✓ Parsed: ${result.name}(${JSON.stringify(result.arguments)})`);
  } else {
    console.log(`  ✗ Failed to parse`);
  }
  console.log('');
}
