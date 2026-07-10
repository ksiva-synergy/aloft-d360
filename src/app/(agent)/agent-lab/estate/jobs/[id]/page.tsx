import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getJob } from '@/lib/context/reads';
import JobRunPage from '@/components/estate/JobRunPage';

type PageProps = { params: Promise<{ id: string }> };

export default async function JobDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) return notFound();

  const { id } = await params;
  const org = await getDefaultOrg();
  const job = await getJob(org.id, id);

  if (!job) return notFound();

  return <JobRunPage job={job as any} />;
}
