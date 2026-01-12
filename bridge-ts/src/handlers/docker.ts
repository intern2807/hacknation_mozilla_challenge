/**
 * Docker Handlers
 * 
 * Handles Docker-related operations including container management,
 * image building, and orphaned container reconnection.
 */

import * as M from '../message-types.js';
import { HandlerContext, MessageHandler, withErrorHandling, requireFields } from './context.js';
import { log } from '../native-messaging.js';
import { getDockerExec } from '../installer/docker-exec.js';
import { getDockerImageManager } from '../installer/docker-images.js';
import { getSecretStore } from '../installer/secrets.js';

// =============================================================================
// Docker Status Handlers
// =============================================================================

/**
 * Check if Docker is available and get image/container status.
 */
export const handleCheckDocker: MessageHandler = withErrorHandling(
  'check_docker_result',
  'docker_error',
  async (_ctx) => {
    const dockerExec = getDockerExec();
    const info = await dockerExec.checkDocker();
    
    // Also get image status and containers if Docker is available
    let images: Record<string, { exists: boolean; size?: string }> = {};
    let containers: Array<{
      id: string;
      name: string;
      serverId: string;
      image: string;
      status: 'running' | 'stopped';
      statusText: string;
      uptime?: string;
      cpu?: string;
      memory?: string;
    }> = [];
    
    if (info.available) {
      // Get image status
      const imageManager = getDockerImageManager();
      images = await imageManager.getImagesStatus();
      
      // Get running containers and their stats
      const containerList = dockerExec.listHarborContainers();
      const stats = dockerExec.getContainerStats();
      
      // Merge stats into container info
      containers = containerList.map(container => {
        const containerStats = stats.find(s => s.serverId === container.serverId);
        return {
          id: container.id,
          name: container.name,
          serverId: container.serverId,
          image: container.image,
          status: container.status,
          statusText: container.statusText,
          uptime: container.uptime,
          cpu: containerStats?.cpu,
          memory: containerStats?.memory,
        };
      });
    }
    
    return {
      ...info,
      images,
      containers,
    };
  }
);

/**
 * Build Docker images for MCP server execution.
 */
export const handleBuildDockerImages: MessageHandler = withErrorHandling(
  'build_docker_images_result',
  'docker_build_error',
  async (ctx) => {
    const imageType = ctx.message.image_type as string | undefined;
    
    const imageManager = getDockerImageManager();
    
    if (imageType) {
      // Build specific image
      await imageManager.buildImage(imageType as 'node' | 'python' | 'binary' | 'multi');
      return { built: [imageType] };
    } else {
      // Build all images
      await imageManager.rebuildAllImages();
      return { built: ['node', 'python', 'binary', 'multi'] };
    }
  }
);

// =============================================================================
// Docker Mode Handlers
// =============================================================================

/**
 * Set Docker mode for a server.
 */
export const handleSetDockerMode: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('set_docker_mode_result', 'docker_mode_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const useDocker = ctx.message.use_docker as boolean ?? true;
    const volumes = ctx.message.volumes as string[] | undefined;
    
    ctx.installer.setDockerMode(serverId, useDocker, volumes);
    
    return {
      server_id: serverId,
      use_docker: useDocker,
      volumes,
    };
  })
);

/**
 * Check if Docker should be preferred for a server.
 */
export const handleShouldPreferDocker: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('should_prefer_docker_result', 'docker_check_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    
    const result = await ctx.installer.shouldPreferDocker(serverId);
    return result;
  })
);

// =============================================================================
// Container Management Handlers
// =============================================================================

/**
 * Reconnect to orphaned Docker containers.
 * This is called on extension startup to restore connections.
 */
export const handleReconnectOrphanedContainers: MessageHandler = async (ctx) => {
  try {
    const dockerExec = getDockerExec();
    const info = await dockerExec.checkDocker();
    
    if (!info.available) {
      return ctx.result('reconnect_orphaned_containers_result', {
        reconnected: [],
        failed: [],
        message: 'Docker not available',
      });
    }
    
    // Get running Harbor containers
    const containers = dockerExec.listHarborContainers();
    const runningContainers = containers.filter(c => c.status === 'running');
    
    if (runningContainers.length === 0) {
      return ctx.result('reconnect_orphaned_containers_result', {
        reconnected: [],
        failed: [],
        message: 'No orphaned containers found',
      });
    }
    
    // Check which ones we're not connected to
    const connectedServerIds = new Set(
      ctx.mcpManager.getAllConnections().map(c => c.serverId)
    );
    
    const orphaned = runningContainers.filter(c => !connectedServerIds.has(c.serverId));
    
    if (orphaned.length === 0) {
      return ctx.result('reconnect_orphaned_containers_result', {
        reconnected: [],
        failed: [],
        message: 'All containers are connected',
      });
    }
    
    log(`[handleReconnectOrphanedContainers] Found ${orphaned.length} orphaned containers`);
    
    const reconnected: string[] = [];
    const failed: Array<{ serverId: string; error: string }> = [];
    
    for (const container of orphaned) {
      const serverId = container.serverId;
      log(`[handleReconnectOrphanedContainers] Reconnecting ${serverId}...`);
      
      // Get the installed server config
      const server = ctx.installer.getServer(serverId);
      if (!server) {
        log(`[handleReconnectOrphanedContainers] Server ${serverId} not found in installed servers`);
        // Stop the orphan since we don't have its config
        await dockerExec.stopContainer(serverId);
        failed.push({ serverId, error: 'Server not installed' });
        continue;
      }
      
      try {
        // Stop the old container first (we can't reattach to its stdio)
        log(`[handleReconnectOrphanedContainers] Stopping old container for ${serverId}`);
        await dockerExec.stopContainer(serverId);
        
        // Small delay to ensure container is fully stopped
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Get secrets for this server
        const secretStore = getSecretStore();
        const envVars = secretStore.getAll(serverId);
        
        // Reconnect via Docker
        log(`[handleReconnectOrphanedContainers] Starting fresh connection for ${serverId}`);
        const result = await ctx.mcpManager.connect(server, envVars, { useDocker: true });
        
        if (result.success) {
          reconnected.push(serverId);
          log(`[handleReconnectOrphanedContainers] Successfully reconnected ${serverId}`);
        } else {
          failed.push({ serverId, error: result.error || 'Connection failed' });
          log(`[handleReconnectOrphanedContainers] Failed to reconnect ${serverId}: ${result.error}`);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        failed.push({ serverId, error: errorMsg });
        log(`[handleReconnectOrphanedContainers] Error reconnecting ${serverId}: ${errorMsg}`);
      }
    }
    
    return ctx.result('reconnect_orphaned_containers_result', {
      reconnected,
      failed,
      message: `Reconnected ${reconnected.length} of ${orphaned.length} orphaned containers`,
    });
  } catch (e) {
    log(`Failed to reconnect orphaned containers: ${e}`);
    return ctx.error('reconnect_error', e instanceof Error ? e.message : String(e));
  }
};

