/**
 * Multi-Provider LLM Tests
 * 
 * Tests for configuring and using multiple LLM providers,
 * including provider selection and the new JS API.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getLLMManager, LLMManager } from '../manager.js';
import type { ChatRequest } from '../provider.js';

describe('Multi-Provider LLM Support', () => {
  let manager: LLMManager;

  beforeEach(async () => {
    manager = getLLMManager();
    await manager.detectAll();
  });

  describe('Provider Listing', () => {
    it('should list all registered providers', () => {
      const status = manager.getAllStatus();
      
      // Should have at least local providers (ollama, llamafile)
      expect(status.length).toBeGreaterThan(0);
      
      // Each status should have required fields
      for (const s of status) {
        expect(s.id).toBeDefined();
        expect(s.name).toBeDefined();
        expect(typeof s.available).toBe('boolean');
        expect(s.baseUrl).toBeDefined();
        expect(s.checkedAt).toBeDefined();
      }
    });

    it('should return supported provider types', () => {
      const supported = manager.getSupportedProviders();
      
      expect(supported.local).toContain('ollama');
      expect(supported.local).toContain('llamafile');
      expect(supported.remote).toContain('openai');
      expect(supported.remote).toContain('anthropic');
      expect(supported.remote).toContain('mistral');
      expect(supported.remote).toContain('groq');
    });

    it('should track available vs configured providers', () => {
      const all = manager.getAllStatus();
      const available = manager.getAvailableProviders();
      
      // Available should be a subset of all
      expect(available.length).toBeLessThanOrEqual(all.length);
      
      // All available should have available: true
      for (const p of available) {
        expect(p.available).toBe(true);
      }
    });
  });

  describe('Active Provider', () => {
    it('should return null if no provider is active', () => {
      // After fresh init, might have an active or not
      const activeId = manager.getActiveId();
      const activeModel = manager.getActiveModelId();
      
      // Both should be consistently null or have values
      if (activeId === null) {
        expect(activeModel).toBe(null);
      }
    });

    it('should auto-select first available provider on detect', async () => {
      await manager.detectAll();
      
      const available = manager.getAvailableProviders();
      const activeId = manager.getActiveId();
      
      if (available.length > 0) {
        // Should have auto-selected first available
        expect(activeId).toBeDefined();
        expect(available.map(p => p.id)).toContain(activeId);
      }
    });

    it('should be able to set active provider', async () => {
      await manager.detectAll();
      
      const available = manager.getAvailableProviders();
      if (available.length === 0) {
        console.log('Skipping - no available providers');
        return;
      }
      
      const firstAvailable = available[0];
      const success = manager.setActive(firstAvailable.id);
      
      expect(success).toBe(true);
      expect(manager.getActiveId()).toBe(firstAvailable.id);
    });

    it('should fail to set unavailable provider as active', () => {
      const success = manager.setActive('nonexistent-provider');
      expect(success).toBe(false);
    });
  });

  describe('Provider-Specific Chat', () => {
    it('should use active provider by default', async () => {
      await manager.detectAll();
      
      if (!manager.hasAvailableProvider()) {
        console.log('Skipping - no available providers');
        return;
      }
      
      const activeId = manager.getActiveId();
      expect(activeId).toBeDefined();
      
      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };
      
      const response = await manager.chat(request);
      expect(response).toBeDefined();
      expect(response.message).toBeDefined();
    });

    it('should use specified model if provided', async () => {
      await manager.detectAll();
      
      if (!manager.hasAvailableProvider()) {
        console.log('Skipping - no available providers');
        return;
      }
      
      const activeStatus = manager.getActiveStatus();
      if (!activeStatus?.models?.length) {
        console.log('Skipping - no models available');
        return;
      }
      
      const specificModel = activeStatus.models[0].id;
      
      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: specificModel,
      };
      
      const response = await manager.chat(request);
      expect(response).toBeDefined();
    });
  });

  describe('API Key Management', () => {
    it('should track which providers have API keys', () => {
      const configured = manager.getConfiguredApiKeys();
      expect(Array.isArray(configured)).toBe(true);
    });

    it('should report whether a provider has API key', () => {
      // Test with provider that definitely doesn't have a key
      const hasKey = manager.hasApiKey('nonexistent');
      expect(hasKey).toBe(false);
      
      // Local providers don't need keys
      expect(manager.hasApiKey('ollama')).toBe(false);
    });
  });

  describe('Manager Summary', () => {
    it('should return comprehensive summary', async () => {
      await manager.detectAll();
      
      const summary = manager.getSummary();
      
      expect(typeof summary.providers).toBe('number');
      expect(typeof summary.available).toBe('number');
      expect(Array.isArray(summary.configuredApiKeys)).toBe(true);
      
      // Summary should be consistent with individual queries
      expect(summary.available).toBe(manager.getAvailableProviders().length);
      expect(summary.activeProvider).toBe(manager.getActiveId());
      expect(summary.activeModel).toBe(manager.getActiveModelId());
    });
  });
});

describe('Provider Selection Integration', () => {
  // These tests require specific providers to be available
  // They're informational and won't fail if providers are missing
  
  it('should log available providers for debugging', async () => {
    const manager = getLLMManager();
    await manager.detectAll();
    
    const summary = manager.getSummary();
    console.log('\n=== LLM Provider Status ===');
    console.log(`Total providers: ${summary.providers}`);
    console.log(`Available: ${summary.available}`);
    console.log(`Active: ${summary.activeProvider} / ${summary.activeModel}`);
    console.log(`Configured API keys: ${summary.configuredApiKeys.join(', ') || 'none'}`);
    
    const allStatus = manager.getAllStatus();
    console.log('\nProvider details:');
    for (const s of allStatus) {
      const status = s.available ? '✓' : '✗';
      const tools = s.supportsTools ? '(tools)' : '';
      const models = s.models?.length ? `[${s.models.length} models]` : '';
      console.log(`  ${status} ${s.id}: ${s.name} ${tools} ${models}`);
      if (s.error) {
        console.log(`    Error: ${s.error}`);
      }
    }
    console.log('=========================\n');
  });
});

