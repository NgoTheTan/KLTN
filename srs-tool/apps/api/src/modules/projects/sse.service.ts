import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface RunEvent {
  runId: string;
  type: 'progress' | 'decision' | 'needs_input' | 'requirement_updated' | 'status' | 'error';
  data: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly eventSubject = new Subject<RunEvent>();

  /**
   * Emit an event for a specific run.
   */
  emit(runId: string, type: RunEvent['type'], data: Record<string, unknown>) {
    const event: RunEvent = {
      runId,
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.logger.debug(`[SSE] Emit run=${runId} type=${type}`);
    this.eventSubject.next(event);
  }

  /**
   * Subscribe to SSE events for a specific runId.
   */
  getEventStream(runId: string): Observable<{ data: string }> {
    return this.eventSubject.asObservable().pipe(
      filter((e) => e.runId === runId),
      map((e) => ({
        data: JSON.stringify({
          type: e.type,
          timestamp: e.timestamp,
          ...e.data,
        }),
      })),
    );
  }
}
