/**
 * Ports (interfaces) that decouple business logic from infrastructure adapters.
 * Business modules only depend on these interfaces, never on concrete implementations.
 * This makes unit testing and adapter swapping easy.
 */

// StoragePort

export interface UploadResult {
  s3Key: string;
  url: string;
  sha256: string;
}

export interface StoragePort {
  /** Upload a file to object storage. Returns S3 key and SHA-256. */
  upload(buffer: Buffer, key: string, contentType: string): Promise<UploadResult>;
  /** Generate a pre-signed download URL valid for ttlSeconds. */
  presignedUrl(s3Key: string, ttlSeconds: number): Promise<string>;
  /** Delete a file from object storage. */
  delete(s3Key: string): Promise<void>;
}

// QueuePort

export interface JobPayload {
  type: 'pipeline' | 'architecture' | 'export';
  projectId: string;
  runId: string;
  mode?: 'eco' | 'standard' | 'thorough';
  fromStage?: number;
  [key: string]: unknown;
}

export interface QueuePort {
  /** Enqueue a job for async processing by the Worker. */
  enqueue(payload: JobPayload, options?: { priority?: number; delay?: number }): Promise<string>;
  /** Get job status. */
  getJobStatus(jobId: string): Promise<{ status: string; progress: number }>;
}

// RenderPort

export interface RenderResult {
  svg?: string;
  png?: Buffer;
  error?: string;
  errorLine?: number;
}

export interface RenderPort {
  /** Render PlantUML source to SVG/PNG via the PlantUML container (no egress). */
  render(puml: string, format: 'svg' | 'png'): Promise<RenderResult>;
}
