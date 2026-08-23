import { handler } from '@/lib/api';
import { requireCompany } from '@/lib/auth/guards';
import { getJob, listJobs } from '@/lib/db/repositories/jobs';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Poll a specific job, or list recent jobs for the company. */
export async function GET(request: Request) {
  return handler(async () => {
    const url = new URL(request.url);
    const { company } = await requireCompany(url.searchParams.get('company'));
    const jobId = url.searchParams.get('jobId');
    if (jobId) {
      const job = await getJob(jobId);
      if (!job || job.companyId !== company.id) throw new AppError('NOT_FOUND', 'Job not found.');
      return { job };
    }
    return { jobs: await listJobs(company.id, 20) };
  });
}
