'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { PipelineCanvas } from '@/components/pipeline/pipeline-canvas';
import { usePipelineStore } from '@/stores/pipeline-store';
import { Icon } from '@iconify/react';

export default function CanvasPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pipelineId = params.id as string;
  const shareToken = searchParams.get('token');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(false);
  
  const { loadPipeline, currentPipeline } = usePipelineStore();

  useEffect(() => {
    const verifyAndLoadPipeline = async () => {
      if (!pipelineId) {
        setError('No pipeline ID provided');
        setLoading(false);
        return;
      }

      try {
        // First, verify access to this pipeline
        const verifyRes = await fetch('/api/pipelines/verify-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            pipelineId, 
            shareToken: shareToken || undefined 
          }),
        });

        if (!verifyRes.ok) {
          const data = await verifyRes.json();
          if (verifyRes.status === 401) {
            // Unauthorized - redirect to login
            router.push(`/login?redirectTo=/canvas/${pipelineId}${shareToken ? `?token=${shareToken}` : ''}`);
            return;
          }
          if (verifyRes.status === 403) {
            setError('You do not have permission to access this pipeline');
            setLoading(false);
            return;
          }
          if (verifyRes.status === 404) {
            setError('Pipeline not found');
            setLoading(false);
            return;
          }
          setError(data.error || 'Failed to verify access');
          setLoading(false);
          return;
        }

        // Access verified, now load the pipeline
        setAccessGranted(true);
        await loadPipeline(pipelineId, shareToken || undefined);
        setLoading(false);
      } catch (err) {
        console.error('Failed to verify/load pipeline:', err);
        setError('Failed to load pipeline');
        setLoading(false);
      }
    };

    verifyAndLoadPipeline();
  }, [pipelineId, shareToken, loadPipeline, router]);

  // Update URL when pipeline changes (for new pipelines)
  useEffect(() => {
    if (currentPipeline && currentPipeline.id !== pipelineId && !loading) {
      // Pipeline was saved with a new ID, update URL
      router.replace(`/canvas/${currentPipeline.id}`, { scroll: false });
    }
  }, [currentPipeline, pipelineId, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Icon 
            icon="solar:spinner-line-duotone" 
            className="size-12 animate-spin text-primary" 
          />
          <p className="text-muted-foreground">Loading pipeline...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="p-4 rounded-full bg-destructive/10">
            <Icon 
              icon="solar:danger-triangle-bold-duotone" 
              className="size-12 text-destructive" 
            />
          </div>
          <h1 className="text-xl font-semibold">Access Denied</h1>
          <p className="text-muted-foreground">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (!accessGranted) {
    return null;
  }

  return <PipelineCanvas />;
}
