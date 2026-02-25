/**
 * Monitoring Events Module
 *
 * Receives events from ottochain-monitoring and queries them for the status page.
 */

import { PrismaClient, MonitoringEventType, MonitoringSeverity, MonitoringScope } from '@prisma/client';

const prisma = new PrismaClient();

export interface MonitoringEventInput {
  eventType: string;
  condition?: string;
  severity?: string;
  scope?: string;
  affectedNodes?: string[];
  affectedLayers?: string[];
  success?: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface MonitoringActivity {
  lastRestart: {
    timestamp: Date;
    condition: string;
    scope: string;
    success: boolean;
    affectedNodes: string[];
    affectedLayers: string[];
  } | null;
  activeAlerts: Array<{
    timestamp: Date;
    condition: string;
    severity: string;
    message: string;
    affectedNodes: string[];
    affectedLayers: string[];
  }>;
  recentEvents: Array<{
    timestamp: Date;
    eventType: string;
    condition: string | null;
    severity: string | null;
    message: string | null;
    success: boolean | null;
  }>;
  monitoringStatus: 'running' | 'stopped' | 'unknown';
  lastSeen: Date | null;
}

/**
 * Store a monitoring event from ottochain-monitoring.
 */
export async function storeEvent(event: MonitoringEventInput): Promise<void> {
  await prisma.monitoringEvent.create({
    data: {
      eventType: event.eventType as MonitoringEventType,
      condition: event.condition,
      severity: event.severity as MonitoringSeverity | undefined,
      scope: event.scope as MonitoringScope | undefined,
      affectedNodes: event.affectedNodes ?? [],
      affectedLayers: event.affectedLayers ?? [],
      success: event.success,
      message: event.message,
      details: event.details ?? undefined,
    },
  });
}

/**
 * Get monitoring activity summary for the status page.
 */
export async function getMonitoringActivity(): Promise<MonitoringActivity> {
  // Last restart
  const lastRestart = await prisma.monitoringEvent.findFirst({
    where: { eventType: 'RESTART' },
    orderBy: { timestamp: 'desc' },
  });

  // Active alerts (alerts without a subsequent RESOLVED event)
  const recentAlerts = await prisma.monitoringEvent.findMany({
    where: {
      eventType: 'ALERT',
      timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
    },
    orderBy: { timestamp: 'desc' },
  });

  // Find which alerts have been resolved
  const resolvedConditions = await prisma.monitoringEvent.findMany({
    where: {
      eventType: 'RESOLVED',
      timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { condition: true, timestamp: true },
  });

  const activeAlerts = recentAlerts.filter(alert => {
    // Alert is active if no RESOLVED event for this condition after the alert
    const resolved = resolvedConditions.find(
      r => r.condition === alert.condition && r.timestamp > alert.timestamp
    );
    return !resolved;
  });

  // Recent events (last 20)
  const recentEvents = await prisma.monitoringEvent.findMany({
    orderBy: { timestamp: 'desc' },
    take: 20,
    select: {
      timestamp: true,
      eventType: true,
      condition: true,
      severity: true,
      message: true,
      success: true,
    },
  });

  // Monitoring status (check for recent lifecycle events)
  const lastLifecycle = await prisma.monitoringEvent.findFirst({
    where: {
      eventType: { in: ['MONITORING_START', 'MONITORING_STOP'] },
    },
    orderBy: { timestamp: 'desc' },
  });

  const lastEvent = await prisma.monitoringEvent.findFirst({
    orderBy: { timestamp: 'desc' },
  });

  let monitoringStatus: 'running' | 'stopped' | 'unknown' = 'unknown';
  if (lastLifecycle) {
    monitoringStatus = lastLifecycle.eventType === 'MONITORING_START' ? 'running' : 'stopped';
  }

  return {
    lastRestart: lastRestart
      ? {
          timestamp: lastRestart.timestamp,
          condition: lastRestart.condition ?? 'unknown',
          scope: lastRestart.scope ?? 'unknown',
          success: lastRestart.success ?? false,
          affectedNodes: lastRestart.affectedNodes,
          affectedLayers: lastRestart.affectedLayers,
        }
      : null,
    activeAlerts: activeAlerts.map(a => ({
      timestamp: a.timestamp,
      condition: a.condition ?? 'unknown',
      severity: a.severity ?? 'WARNING',
      message: a.message ?? '',
      affectedNodes: a.affectedNodes,
      affectedLayers: a.affectedLayers,
    })),
    recentEvents: recentEvents.map(e => ({
      timestamp: e.timestamp,
      eventType: e.eventType,
      condition: e.condition,
      severity: e.severity,
      message: e.message,
      success: e.success,
    })),
    monitoringStatus,
    lastSeen: lastEvent?.timestamp ?? null,
  };
}

/**
 * Get restart history.
 */
export async function getRestartHistory(limit: number = 50): Promise<Array<{
  timestamp: Date;
  condition: string | null;
  scope: string | null;
  success: boolean | null;
  affectedNodes: string[];
  affectedLayers: string[];
  message: string | null;
}>> {
  const restarts = await prisma.monitoringEvent.findMany({
    where: { eventType: 'RESTART' },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  return restarts.map(r => ({
    timestamp: r.timestamp,
    condition: r.condition,
    scope: r.scope,
    success: r.success,
    affectedNodes: r.affectedNodes,
    affectedLayers: r.affectedLayers,
    message: r.message,
  }));
}

/**
 * Cleanup old events (keep last 30 days).
 */
export async function cleanupOldEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.monitoringEvent.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Close Prisma connection.
 */
export async function closeEvents(): Promise<void> {
  await prisma.$disconnect();
}
