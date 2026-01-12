/**
 * Tool Call Parser
 * 
 * Parses tool calls from LLM text output when the model doesn't use
 * the native tool calling format. This handles various text formats
 * that models use when instructed to call tools via prompts.
 * 
 * Supported formats:
 * 1. {"name": "tool_name", "parameters": {...}} - Standard JSON
 * 2. "tool_name": {...} - Key-value format
 * 3. tool_name({...}) - Function call style
 * 4. Loose format - Tool name mentioned with JSON args nearby
 * 5. Bare tool name - Just the tool name for no-arg tools
 */

import { ToolCall } from '../llm/index.js';
import { log } from '../native-messaging.js';

/**
 * Simple mapping from tool name to server ID.
 * Keys are full tool names (prefixed with server__), values are server IDs.
 * 
 * Note: This is a simplified version for parsing. The orchestrator uses a
 * richer ToolMapping interface with additional metadata.
 */
export type ToolNameToServerMap = Record<string, string>;

/**
 * Configuration for parsing.
 */
export interface ParseConfig {
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * LLM special tokens that should be cleaned from output.
 * These sometimes leak into responses from local models.
 */
const LLM_TOKENS_TO_CLEAN = [
  /<\|eot_id\|>/g,
  /<\|end_of_text\|>/g,
  /<\|begin_of_text\|>/g,
  /<\|start_header_id\|>.*?<\|end_header_id\|>/g,
  /<\|im_end\|>/g,
  /<\|im_start\|>/g,
  /<\/s>/g,
  /<s>/g,
];

/**
 * Clean LLM special tokens from output.
 * These tokens sometimes leak into responses from local models.
 */
export function cleanLLMTokens(content: string): string {
  let result = content;
  for (const pattern of LLM_TOKENS_TO_CLEAN) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

/**
 * Extract content from markdown code blocks if present.
 * Handles ```json ... ``` or ``` ... ```
 */
export function extractFromCodeBlock(content: string): string {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return match ? match[1].trim() : content;
}

/**
 * Extract a balanced JSON object starting at a given index.
 * Returns the JSON string or null if braces are unbalanced.
 */
export function extractJsonObject(content: string, startIdx: number): string | null {
  let braceCount = 0;
  let endIdx = startIdx;
  let inString = false;
  let escapeNext = false;
  
  for (let i = startIdx; i < content.length; i++) {
    const char = content[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
  }
  
  if (braceCount !== 0) {
    log(`[ToolCallParser] extractJsonObject: Unbalanced braces`);
    return null;
  }
  
  return content.slice(startIdx, endIdx);
}

/**
 * Build a list of tool names to search for (both prefixed and short forms).
 */
function buildSearchNames(toolNames: string[]): Array<{ searchName: string; prefixedName: string }> {
  const names: Array<{ searchName: string; prefixedName: string }> = [];
  
  for (const prefixedName of toolNames) {
    names.push({ searchName: prefixedName, prefixedName });
    
    // Also add short name (without server prefix)
    const shortName = prefixedName.split('__').pop();
    if (shortName && shortName !== prefixedName) {
      names.push({ searchName: shortName, prefixedName });
    }
  }
  
  return names;
}

/**
 * Generate a unique tool call ID.
 */
function generateToolCallId(): string {
  return `text_call_${Date.now()}`;
}

// =============================================================================
// Parse Strategy 1: {"name": "tool_name", "parameters": {...}}
// =============================================================================

/**
 * Try to parse {"name": "tool_name", "parameters": {...}} format.
 */
export function tryParseNameFormat(content: string, toolMapping: ToolNameToServerMap): ToolCall | null {
  try {
    // Look for {"name" or { "name" (with whitespace)
    let startIdx = content.indexOf('{"name"');
    if (startIdx === -1) {
      const match = content.match(/\{\s*"name"/);
      if (match && match.index !== undefined) {
        startIdx = match.index;
      }
    }
    if (startIdx === -1) return null;
    
    const jsonStr = extractJsonObject(content, startIdx);
    if (!jsonStr) {
      log(`[ToolCallParser] tryParseNameFormat: Could not extract JSON object`);
      return null;
    }
    
    log(`[ToolCallParser] tryParseNameFormat: Extracted JSON: ${jsonStr}`);
    
    const parsed = JSON.parse(jsonStr);
    if (!parsed.name) return null;
    
    log(`[ToolCallParser] tryParseNameFormat: Looking for tool "${parsed.name}"`);
    log(`[ToolCallParser] tryParseNameFormat: Available tools: ${Object.keys(toolMapping).join(', ')}`);
    
    // Try exact match first
    let matchedName = toolMapping[parsed.name] ? parsed.name : null;
    
    // If not found, try to find a prefixed version (server__toolname)
    if (!matchedName) {
      for (const prefixedName of Object.keys(toolMapping)) {
        const shortName = prefixedName.split('__').pop();
        if (shortName === parsed.name) {
          matchedName = prefixedName;
          log(`[ToolCallParser] Matched unprefixed name "${parsed.name}" to "${prefixedName}"`);
          break;
        }
        
        // Also try matching if the model used a similar prefix
        // e.g., model outputs "github__search" but actual is "github-npm__search"
        const modelTool = parsed.name.split('__').slice(1).join('__');
        const actualTool = prefixedName.split('__').slice(1).join('__');
        if (modelTool && actualTool && modelTool === actualTool) {
          log(`[ToolCallParser] Tool name matches but prefix differs`);
          matchedName = prefixedName;
          break;
        }
      }
    }
    
    if (matchedName) {
      const args = (parsed.parameters || parsed.arguments || {}) as Record<string, unknown>;
      log(`[ToolCallParser] Parsed name format: ${matchedName} with args: ${JSON.stringify(args)}`);
      return {
        id: generateToolCallId(),
        name: matchedName,
        arguments: args,
      };
    } else {
      log(`[ToolCallParser] tryParseNameFormat: No matching tool found for "${parsed.name}"`);
    }
  } catch (e) {
    log(`[ToolCallParser] tryParseNameFormat failed: ${e}`);
  }
  return null;
}

// =============================================================================
// Parse Strategy 2: "tool_name": {...} or tool_name: {...}
// =============================================================================

/**
 * Try to parse "tool_name": {...} or tool_name: {...} format.
 */
export function tryParseKeyValueFormat(
  content: string, 
  toolNames: string[], 
  toolMapping: ToolNameToServerMap
): ToolCall | null {
  const namesToSearch = buildSearchNames(toolNames);
  
  for (const { searchName, prefixedName } of namesToSearch) {
    // Look for "tool_name": { or tool_name: {
    const escapedName = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      `"${escapedName}":\\s*\\{`,
      `${escapedName}:\\s*\\{`,
      `\`${escapedName}\`:\\s*\\{`,
    ];
    
    for (const pattern of patterns) {
      const regex = new RegExp(pattern);
      const match = content.match(regex);
      if (match && match.index !== undefined) {
        try {
          const braceStart = content.indexOf('{', match.index);
          if (braceStart === -1) continue;
          
          const jsonStr = extractJsonObject(content, braceStart);
          if (!jsonStr) continue;
          
          const args = JSON.parse(jsonStr);
          log(`[ToolCallParser] Parsed key-value format for: ${searchName} -> ${prefixedName}`);
          return {
            id: generateToolCallId(),
            name: prefixedName,
            arguments: args as Record<string, unknown>,
          };
        } catch (e) {
          log(`[ToolCallParser] tryParseKeyValueFormat failed for ${searchName}: ${e}`);
        }
      }
    }
  }
  return null;
}

// =============================================================================
// Parse Strategy 3: tool_name({...}) function call style
// =============================================================================

/**
 * Try to parse tool_name({...}) function call format.
 */
export function tryParseFunctionCallFormat(
  content: string, 
  toolNames: string[], 
  toolMapping: ToolNameToServerMap
): ToolCall | null {
  const namesToSearch = buildSearchNames(toolNames);
  
  for (const { searchName, prefixedName } of namesToSearch) {
    const pattern = new RegExp(`${searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(\\s*\\{`);
    const match = content.match(pattern);
    if (match && match.index !== undefined) {
      try {
        const braceStart = content.indexOf('{', match.index);
        if (braceStart === -1) continue;
        
        const jsonStr = extractJsonObject(content, braceStart);
        if (!jsonStr) continue;
        
        const args = JSON.parse(jsonStr);
        log(`[ToolCallParser] Parsed function call format for: ${searchName} -> ${prefixedName}`);
        return {
          id: generateToolCallId(),
          name: prefixedName,
          arguments: args as Record<string, unknown>,
        };
      } catch (e) {
        log(`[ToolCallParser] tryParseFunctionCallFormat failed for ${searchName}: ${e}`);
      }
    }
  }
  return null;
}

// =============================================================================
// Parse Strategy 3b: Python-style function call: tool_name(key='value', key2="value2")
// =============================================================================

/**
 * Try to parse Python-style function calls: tool_name(key='value', key2="value2")
 * This is common output from Mistral and some other models.
 */
export function tryParsePythonFunctionFormat(
  content: string, 
  toolNames: string[], 
  toolMapping: ToolNameToServerMap
): ToolCall | null {
  const namesToSearch = buildSearchNames(toolNames);
  
  for (const { searchName, prefixedName } of namesToSearch) {
    // Also try with underscores instead of double underscore (model might output r_gmail_mcp_server__search instead of r-gmail-mcp-server__search)
    const searchVariants = [
      searchName,
      searchName.replace(/-/g, '_'),  // r-gmail -> r_gmail
    ];
    
    for (const variant of searchVariants) {
      // Look for tool_name(...)
      const escapedName = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${escapedName}\\s*\\(([^)]+)\\)`, 'i');
      const match = content.match(pattern);
      
      if (match) {
        try {
          const argsStr = match[1].trim();
          
          // Parse Python-style keyword arguments: key='value', key2="value2"
          const args: Record<string, unknown> = {};
          
          // Match key='value' or key="value" patterns
          const argPattern = /(\w+)\s*=\s*['"]([^'"]*)['"]/g;
          let argMatch;
          while ((argMatch = argPattern.exec(argsStr)) !== null) {
            args[argMatch[1]] = argMatch[2];
          }
          
          // Also try to match key=value (without quotes, for numbers/booleans)
          const unquotedPattern = /(\w+)\s*=\s*([^,'")\s]+)/g;
          while ((argMatch = unquotedPattern.exec(argsStr)) !== null) {
            if (!(argMatch[1] in args)) {  // Don't override quoted values
              const val = argMatch[2];
              // Try to parse as number or boolean
              if (val === 'True' || val === 'true') args[argMatch[1]] = true;
              else if (val === 'False' || val === 'false') args[argMatch[1]] = false;
              else if (val === 'None' || val === 'null') args[argMatch[1]] = null;
              else if (!isNaN(Number(val))) args[argMatch[1]] = Number(val);
              else args[argMatch[1]] = val;
            }
          }
          
          if (Object.keys(args).length > 0) {
            log(`[ToolCallParser] Parsed Python function format for: ${variant} -> ${prefixedName}`);
            log(`[ToolCallParser] Parsed args: ${JSON.stringify(args)}`);
            return {
              id: generateToolCallId(),
              name: prefixedName,
              arguments: args,
            };
          }
        } catch (e) {
          log(`[ToolCallParser] tryParsePythonFunctionFormat failed for ${variant}: ${e}`);
        }
      }
    }
  }
  return null;
}

// =============================================================================
// Parse Strategy 4: Loose matching (tool name mentioned + JSON nearby)
// =============================================================================

/**
 * Try to loosely match tool names and extract any JSON object as parameters.
 */
export function tryParseLooseFormat(
  content: string, 
  toolNames: string[], 
  toolMapping: ToolNameToServerMap
): ToolCall | null {
  const contentLower = content.toLowerCase();
  
  for (const prefixedName of toolNames) {
    const shortName = prefixedName.split('__').pop() || prefixedName;
    
    // Check if tool name is mentioned (case insensitive, with or without underscores)
    const normalizedTool = prefixedName.toLowerCase().replace(/__/g, '_');
    const normalizedShort = shortName.toLowerCase().replace(/_/g, ' ');
    const shortLower = shortName.toLowerCase();
    
    if (contentLower.includes(normalizedTool) || 
        contentLower.includes(prefixedName.toLowerCase()) ||
        contentLower.includes(shortLower) ||
        contentLower.includes(normalizedShort)) {
      // Find the first JSON object in the content
      const braceStart = content.indexOf('{');
      if (braceStart === -1) continue;
      
      try {
        const jsonStr = extractJsonObject(content, braceStart);
        if (!jsonStr) continue;
        
        const parsed = JSON.parse(jsonStr);
        // Make sure it looks like arguments (not a meta-object with name/tool)
        if (parsed && typeof parsed === 'object' && !parsed.name && !parsed.tool) {
          log(`[ToolCallParser] Parsed loose format for: ${shortName} -> ${prefixedName}`);
          return {
            id: generateToolCallId(),
            name: prefixedName,
            arguments: parsed as Record<string, unknown>,
          };
        }
      } catch (e) {
        log(`[ToolCallParser] tryParseLooseFormat failed for ${prefixedName}: ${e}`);
      }
    }
  }
  return null;
}

// =============================================================================
// Parse Strategy 5: Bare tool name (for no-parameter tools)
// =============================================================================

/**
 * Try to parse a bare tool name (with no parameters).
 * Handles: "get_me", "get_me()", tool names embedded in text like "I'll call get_me now"
 */
export function tryParseBareToolName(
  content: string, 
  toolNames: string[], 
  toolMapping: ToolNameToServerMap
): ToolCall | null {
  const contentTrimmed = content.trim();
  const contentLower = contentTrimmed.toLowerCase();
  
  const namesToSearch = buildSearchNames(toolNames);
  
  // Sort by name length (longer names first) to avoid partial matches
  namesToSearch.sort((a, b) => b.searchName.length - a.searchName.length);
  
  for (const { searchName, prefixedName } of namesToSearch) {
    const searchLower = searchName.toLowerCase();
    
    // Check for exact match (content is just the tool name)
    if (contentLower === searchLower || 
        contentLower === `${searchLower}()` || 
        contentLower === `${searchLower}({})`) {
      log(`[ToolCallParser] Parsed bare tool name (exact): ${searchName} -> ${prefixedName}`);
      return {
        id: generateToolCallId(),
        name: prefixedName,
        arguments: {},
      };
    }
    
    // Check for tool name at word boundaries in short content (< 100 chars suggests just calling a tool)
    if (contentTrimmed.length < 100 && contentTrimmed.length > 0) {
      const escaped = searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const pattern = new RegExp(`(?:^|\\s)${escaped}(?:\\s*\\(\\s*\\{?\\s*\\}?\\s*\\))?(?:\\s|$)`, 'i');
        if (pattern.test(contentTrimmed)) {
          log(`[ToolCallParser] Parsed bare tool name (word boundary): ${searchName} -> ${prefixedName}`);
          return {
            id: generateToolCallId(),
            name: prefixedName,
            arguments: {},
          };
        }
      } catch {
        // Invalid regex, skip
        log(`[ToolCallParser] Invalid regex for tool name: ${searchName}`);
      }
    }
  }
  
  return null;
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a tool call from LLM text output.
 * 
 * This is a fallback for models that don't support native tool calling.
 * It tries multiple parsing strategies in order of specificity.
 * 
 * @param content - The LLM output text
 * @param toolMapping - Mapping of tool names to server IDs
 * @returns Parsed ToolCall or null if no valid format found
 */
export function parseToolCallFromText(
  content: string, 
  toolMapping: ToolNameToServerMap
): ToolCall | null {
  // Clean up LLM special tokens
  let cleanedContent = cleanLLMTokens(content);
  
  // Extract from code blocks if present
  cleanedContent = extractFromCodeBlock(cleanedContent);
  
  log(`[ToolCallParser] parseToolCall: Attempting to parse: ${cleanedContent.substring(0, 300)}`);
  
  const toolNames = Object.keys(toolMapping);
  
  // Try each parsing strategy in order of specificity
  
  // Format 1: {"name": "tool_name", ...}
  const result1 = tryParseNameFormat(cleanedContent, toolMapping);
  if (result1) return result1;
  
  // Format 2: "tool_name": {...} or tool_name: {...}
  const result2 = tryParseKeyValueFormat(cleanedContent, toolNames, toolMapping);
  if (result2) return result2;
  
  // Format 3: tool_name({...}) function call style (JSON args)
  const result3 = tryParseFunctionCallFormat(cleanedContent, toolNames, toolMapping);
  if (result3) return result3;
  
  // Format 3b: tool_name(key='value') Python-style function call
  const result3b = tryParsePythonFunctionFormat(cleanedContent, toolNames, toolMapping);
  if (result3b) return result3b;
  
  // Format 4: Check if LLM mentioned a tool name and we can extract params
  const result4 = tryParseLooseFormat(cleanedContent, toolNames, toolMapping);
  if (result4) return result4;
  
  // Format 5: Just tool name by itself (for tools with no required parameters)
  const result5 = tryParseBareToolName(cleanedContent, toolNames, toolMapping);
  if (result5) return result5;
  
  log('[ToolCallParser] parseToolCall: No valid tool call format found');
  return null;
}

