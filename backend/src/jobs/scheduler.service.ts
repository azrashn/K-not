/**
 * Periodic orchestration (document-lifecycle.md §3.2, §4.2): dispatcher (10 s), stall sweeper
 * (30 s), purge retry (5 min) and the AI index consistency check (60 s). Each loop never
 * overlaps itself; errors are logged and the loop continues. Disabled with SCHEDULER_ENABLED=false
 * (tests drive the same methods directly).
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { IndexVersionService } from '../ai/index-versions';
import { APP_CONFIG, AppConfig } from '../config/config';
import { JobsService } from './jobs.service';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('scheduler');
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly jobs: JobsService,
    private readonly indexVersions: IndexVersionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.schedulerEnabled) return;
    this.every('index-check', this.config.readyCheckIntervalMs, () => this.indexVersions.check());
    this.every('dispatch', this.config.dispatchIntervalMs, () => this.jobs.dispatchDue());
    this.every('sweep', this.config.sweepIntervalMs, () => this.jobs.sweepStalled());
    this.every('purge', this.config.purgeRetryMs, () => this.jobs.purgePending());
    void this.run('index-check', () => this.indexVersions.check());
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearInterval(t);
  }

  private every(name: string, ms: number, fn: () => Promise<unknown>): void {
    const t = setInterval(() => void this.run(name, fn), ms);
    t.unref();
    this.timers.push(t);
  }

  private async run(name: string, fn: () => Promise<unknown>): Promise<void> {
    if (this.running.has(name)) return;
    this.running.add(name);
    try {
      await fn();
    } catch (e) {
      this.log.error({ event: 'scheduler.loop_failed', loop: name, error_type: (e as Error)?.constructor?.name ?? typeof e });
    } finally {
      this.running.delete(name);
    }
  }
}
