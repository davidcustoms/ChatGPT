import { query, queryOne } from '../pool';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

export interface SyncJob {
  id: string;
  companyId: string;
  jobType: string;
  status: JobStatus;
  progressCurrent: number;
  progressTotal: number;
  currentStep: string | null;
  steps: Array<{ label: string; status: string; message?: string }>;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface JobRow {
  id: string;
  company_id: string;
  job_type: string;
  status: JobStatus;
  progress_current: number;
  progress_total: number;
  current_step: string | null;
  steps: SyncJob['steps'];
  error_message: string | null;
  retry_count: number;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function toJob(row: JobRow): SyncJob {
  return {
    id: row.id,
    companyId: row.company_id,
    jobType: row.job_type,
    status: row.status,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    currentStep: row.current_step,
    steps: Array.isArray(row.steps) ? row.steps : [],
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createJob(input: {
  companyId: string;
  jobType: string;
  progressTotal?: number;
  monthsRequested?: number | null;
  triggeredBy?: string;
  requestedBy?: string | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sync_jobs (company_id, job_type, status, progress_total, months_requested, triggered_by, requested_by, started_at)
     VALUES ($1,$2,'running',COALESCE($3,0),$4,COALESCE($5,'manual'),$6, now())
     RETURNING id`,
    [
      input.companyId,
      input.jobType,
      input.progressTotal ?? null,
      input.monthsRequested ?? null,
      input.triggeredBy ?? null,
      input.requestedBy ?? null,
    ],
  );
  return row?.id as string;
}

export async function updateJobProgress(
  jobId: string,
  patch: { current?: number; total?: number; step?: string; appendStep?: { label: string; status: string; message?: string } },
): Promise<void> {
  if (patch.appendStep) {
    await query(
      `UPDATE sync_jobs SET steps = steps || $2::jsonb,
              progress_current = COALESCE($3, progress_current),
              progress_total = COALESCE($4, progress_total),
              current_step = COALESCE($5, current_step)
        WHERE id = $1`,
      [
        jobId,
        JSON.stringify([patch.appendStep]),
        patch.current ?? null,
        patch.total ?? null,
        patch.step ?? null,
      ],
    );
    return;
  }
  await query(
    `UPDATE sync_jobs SET progress_current = COALESCE($2, progress_current),
            progress_total = COALESCE($3, progress_total),
            current_step = COALESCE($4, current_step)
      WHERE id = $1`,
    [jobId, patch.current ?? null, patch.total ?? null, patch.step ?? null],
  );
}

export async function finishJob(
  jobId: string,
  status: JobStatus,
  errorMessage?: string | null,
): Promise<void> {
  await query(
    'UPDATE sync_jobs SET status = $2, error_message = $3, finished_at = now() WHERE id = $1',
    [jobId, status, errorMessage ?? null],
  );
}

export async function incrementRetry(jobId: string): Promise<void> {
  await query('UPDATE sync_jobs SET retry_count = retry_count + 1 WHERE id = $1', [jobId]);
}

export async function getJob(jobId: string): Promise<SyncJob | null> {
  const row = await queryOne<JobRow>('SELECT * FROM sync_jobs WHERE id = $1', [jobId]);
  return row ? toJob(row) : null;
}

export async function listJobs(companyId: string, limit = 20): Promise<SyncJob[]> {
  const rows = await query<JobRow>(
    'SELECT * FROM sync_jobs WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2',
    [companyId, limit],
  );
  return rows.map(toJob);
}

export async function latestJob(companyId: string, jobType?: string): Promise<SyncJob | null> {
  const row = await queryOne<JobRow>(
    `SELECT * FROM sync_jobs WHERE company_id = $1 ${jobType ? 'AND job_type = $2' : ''}
      ORDER BY created_at DESC LIMIT 1`,
    jobType ? [companyId, jobType] : [companyId],
  );
  return row ? toJob(row) : null;
}
