/**
 * Authentication & Credential Handlers
 * 
 * Handles credential management and OAuth flows for MCP servers.
 */

import * as M from '../message-types.js';
import { HandlerContext, MessageHandler, withErrorHandling, requireFields } from './context.js';
import { getSecretStore } from '../installer/secrets.js';
import {
  CredentialType,
  CredentialRequirement,
  StoredCredential,
} from '../types.js';
import {
  startOAuthFlow,
  cancelOAuthFlow,
  revokeOAuthAccess,
  getOAuthStatus,
  isProviderConfigured,
  getConfiguredProviders,
  getHarborOAuthBroker,
} from '../auth/index.js';
import { McpManifest, checkOAuthCapabilities } from '../installer/manifest.js';

// =============================================================================
// Credential Handlers
// =============================================================================

/**
 * Set a credential for a server.
 * Supports API keys, passwords, and other credential types.
 */
export const handleSetCredential: MessageHandler = requireFields(
  ['server_id', 'key', 'value'],
  withErrorHandling('set_credential_result', 'credential_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const key = ctx.message.key as string;
    const value = ctx.message.value as string;
    const credType = (ctx.message.credential_type as CredentialType) || CredentialType.API_KEY;
    const username = ctx.message.username as string | undefined;

    const secretStore = getSecretStore();
    
    const credential: StoredCredential = {
      key,
      value,
      type: credType,
      setAt: Date.now(),
    };
    
    // For password type, include username
    if (credType === CredentialType.PASSWORD && username) {
      credential.username = username;
    }
    
    secretStore.setCredential(serverId, credential);
    
    return { 
      success: true,
      credential: {
        key,
        type: credType,
        setAt: credential.setAt,
      },
    };
  })
);

/**
 * Get the status of credentials for a server.
 * Compares stored credentials against requirements.
 */
export const handleGetCredentialStatus: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('get_credential_status_result', 'credential_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const server = ctx.installer.getServer(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    const secretStore = getSecretStore();
    
    // Convert the old-style requiredEnvVars to CredentialRequirement format
    const requirements: CredentialRequirement[] = (server.requiredEnvVars || [])
      .filter(env => env.isSecret)
      .map(env => ({
        key: env.name,
        label: env.name,
        description: env.description,
        type: CredentialType.API_KEY,
        envVar: env.name,
        required: true,
      }));

    const status = secretStore.getCredentialStatus(serverId, requirements);
    
    return { status };
  })
);

/**
 * Validate credentials for a server.
 */
export const handleValidateCredentials: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('validate_credentials_result', 'credential_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const server = ctx.installer.getServer(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    const secretStore = getSecretStore();
    
    // Convert the old-style requiredEnvVars to CredentialRequirement format
    const requirements: CredentialRequirement[] = (server.requiredEnvVars || [])
      .filter(env => env.isSecret)
      .map(env => ({
        key: env.name,
        label: env.name,
        description: env.description,
        type: CredentialType.API_KEY,
        envVar: env.name,
        required: true,
      }));

    const validation = secretStore.validateCredentials(serverId, requirements);
    
    return { 
      valid: validation.valid,
      errors: validation.errors,
    };
  })
);

/**
 * Delete a credential for a server.
 */
export const handleDeleteCredential: MessageHandler = requireFields(
  ['server_id', 'key'],
  withErrorHandling('delete_credential_result', 'credential_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const key = ctx.message.key as string;

    const secretStore = getSecretStore();
    secretStore.deleteCredential(serverId, key);
    
    return { success: true };
  })
);

/**
 * Get all credentials for a server (without values, for security).
 */
export const handleListCredentials: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('list_credentials_result', 'credential_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const secretStore = getSecretStore();
    const credentials = secretStore.getCredentials(serverId);
    
    // Return metadata only, not the actual values
    const credentialList = credentials.map(c => ({
      key: c.key,
      type: c.type,
      setAt: c.setAt,
      hasUsername: c.type === CredentialType.PASSWORD && !!c.username,
      expiresAt: c.expiresAt,
      isExpired: secretStore.isExpired(c),
    }));
    
    return { credentials: credentialList };
  })
);

// =============================================================================
// OAuth Handlers
// =============================================================================

/**
 * Start an OAuth flow for a server credential.
 */
export const handleOAuthStart: MessageHandler = requireFields(
  ['server_id', 'credential_key', 'provider_id'],
  withErrorHandling('oauth_start_result', 'oauth_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const credentialKey = ctx.message.credential_key as string;
    const providerId = ctx.message.provider_id as string;

    // Check if provider is configured
    if (!isProviderConfigured(providerId)) {
      throw new Error(
        `OAuth provider "${providerId}" is not configured. ` +
        `Please set the HARBOR_${providerId.toUpperCase()}_CLIENT_ID environment variable.`
      );
    }

    const { authUrl, state } = await startOAuthFlow(
      serverId,
      credentialKey,
      providerId
    );

    return {
      auth_url: authUrl,
      state,
      provider_id: providerId,
    };
  })
);

/**
 * Cancel an active OAuth flow.
 */
export const handleOAuthCancel: MessageHandler = requireFields(
  ['state'],
  withErrorHandling('oauth_cancel_result', 'oauth_error', async (ctx) => {
    const state = ctx.message.state as string;

    cancelOAuthFlow(state);
    return { cancelled: true };
  })
);

/**
 * Revoke OAuth access for a server credential.
 */
export const handleOAuthRevoke: MessageHandler = requireFields(
  ['server_id', 'credential_key'],
  withErrorHandling('oauth_revoke_result', 'oauth_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const credentialKey = ctx.message.credential_key as string;

    await revokeOAuthAccess(serverId, credentialKey);
    return { revoked: true };
  })
);

/**
 * Get OAuth status for a server credential.
 */
export const handleOAuthStatus: MessageHandler = requireFields(
  ['server_id', 'credential_key'],
  withErrorHandling('oauth_status_result', 'oauth_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const credentialKey = ctx.message.credential_key as string;

    const status = getOAuthStatus(serverId, credentialKey);
    return { status };
  })
);

/**
 * Get list of configured OAuth providers.
 */
export const handleListOAuthProviders: MessageHandler = withErrorHandling(
  'list_oauth_providers_result',
  'oauth_error',
  async (_ctx) => {
    const providers = getConfiguredProviders();
    return { providers };
  }
);

// =============================================================================
// Manifest OAuth Handlers
// =============================================================================

/**
 * Check if Harbor can handle OAuth for a manifest.
 */
export const handleCheckManifestOAuth: MessageHandler = requireFields(
  ['manifest'],
  async (ctx) => {
    const manifestData = ctx.message.manifest as McpManifest;

    if (!manifestData.oauth) {
      return ctx.result('check_manifest_oauth_result', {
        required: false,
        canHandle: true,
      });
    }

    const broker = getHarborOAuthBroker();
    const capabilities = broker.getCapabilities();
    const check = checkOAuthCapabilities(manifestData.oauth, capabilities);

    return ctx.result('check_manifest_oauth_result', {
      required: true,
      canHandle: check.canHandle,
      recommendedSource: check.recommendedSource,
      hostModeAvailable: check.hostModeAvailable,
      userModeAvailable: check.userModeAvailable,
      missingScopes: check.missingScopes,
      missingApis: check.missingApis,
      reason: check.reason,
    });
  }
);

/**
 * Start OAuth flow for a manifest-installed server.
 */
export const handleManifestOAuthStart: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('manifest_oauth_start_result', 'oauth_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const result = await ctx.installer.startOAuthFlow(serverId);
    
    if ('error' in result) {
      throw new Error(result.error);
    }

    return {
      authUrl: result.authUrl,
      state: result.state,
    };
  })
);

/**
 * Get OAuth status for a manifest-installed server.
 */
export const handleManifestOAuthStatus: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('manifest_oauth_status_result', 'oauth_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const status = ctx.installer.getOAuthStatus(serverId);
    return status;
  })
);

/**
 * Get Harbor's OAuth capabilities.
 */
export const handleGetOAuthCapabilities: MessageHandler = async (ctx) => {
  const capabilities = ctx.installer.getOAuthCapabilities();
  return ctx.result('get_oauth_capabilities_result', { capabilities });
};

