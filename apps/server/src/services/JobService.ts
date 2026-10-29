import crypto from "node:crypto";

export type JobKind =
  | "read"
  | "summarize"
  | "translate"
  | "paraphrase"
  | "edit"
  | "create"
  | "research"
  | "custom";

export type JobStage = "queued" | "running" | "done" | "error" | "needs_input";

export interface Job {
  id: string;
  kind: JobKind;
  stage: JobStage;
  progress: number; // 0.0 to 1.0
  message: string;
  fileName?: string;
  resultId?: string;
  downloadUrl?: string;
  resultBuffer?: Buffer;
  resultText?: string;
  error?: {
    code: string;
    userMessage: string;
  };
  createdAt: number;
  updatedAt: number;
  abortController?: AbortController;
}

export class JobService {
  private jobs: Map<string, Job> = new Map();
  private listeners: Set<(job: Job) => void> = new Set();
  private maxStoredJobs = 50;

  createJob(kind: JobKind, fileName?: string, initialMessage = "Sedang disiapkan..."): Job {
    const id = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job: Job = {
      id,
      kind,
      stage: "queued",
      progress: 0.05,
      message: initialMessage,
      fileName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      abortController: new AbortController(),
    };

    // Cleanup old jobs if limit reached
    if (this.jobs.size >= this.maxStoredJobs) {
      const oldestKey = this.jobs.keys().next().value;
      if (oldestKey) this.jobs.delete(oldestKey);
    }

    this.jobs.set(id, job);
    this.emit(job);
    return job;
  }

  updateJob(id: string, updates: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    Object.assign(job, updates, { updatedAt: Date.now() });
    this.emit(job);
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  listJobs(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.stage === "done" || job.stage === "error") return false;

    if (job.abortController) {
      job.abortController.abort();
    }
    this.updateJob(id, {
      stage: "error",
      message: "Tugas dibatalkan oleh pengguna.",
      error: {
        code: "JOB_CANCELLED",
        userMessage: "Pemrosesan tugas telah dibatalkan.",
      },
    });
    return true;
  }

  onUpdate(listener: (job: Job) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(job: Job): void {
    for (const listener of this.listeners) {
      try {
        listener(job);
      } catch (err) {
        console.error("[JobService] Listener error:", err);
      }
    }
  }
}

export const jobService = new JobService();
