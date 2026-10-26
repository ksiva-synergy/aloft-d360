'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AVAILABLE_MODELS, type ModelOption } from '@/components/agent-lab/workbench/types';
import { filterChatModelsForRole } from '@/lib/inspector/model-access';

export function useInspectorChatModels() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [models, setModels] = useState<ModelOption[]>(() =>
    filterChatModelsForRole(AVAILABLE_MODELS, role),
  );
  const [llmLiteEnabled, setLlmLiteEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const roleFilteredFallback = useMemo(
    () => filterChatModelsForRole(AVAILABLE_MODELS, role),
    [role],
  );

  useEffect(() => {
    setModels((current) => filterChatModelsForRole(current, role));
  }, [role]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/inspector/chat-models')
      .then((r) => (r.ok ? r.json() : { models: roleFilteredFallback }))
      .then((data: { models?: ModelOption[]; llmLiteEnabled?: boolean }) => {
        if (cancelled) return;
        if (Array.isArray(data.models) && data.models.length > 0) {
          setModels(filterChatModelsForRole(data.models, role));
        }
        setLlmLiteEnabled(!!data.llmLiteEnabled);
      })
      .catch(() => {
        if (!cancelled) setModels(roleFilteredFallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role, roleFilteredFallback]);

  return { models, llmLiteEnabled, loading };
}
