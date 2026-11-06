'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AVAILABLE_MODELS, type ModelOption } from '@/components/agent-lab/workbench/types';
import { filterChatModelsForRole } from '@/lib/inspector/model-access';

/** How often to re-pull gateway models while the tab is open (ms). */
const GATEWAY_MODELS_POLL_MS = 60_000;

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
    setModels((current) => (current.length > 0 ? current : roleFilteredFallback));
  }, [roleFilteredFallback]);

  const refreshModels = useCallback(() => {
    return fetch('/api/inspector/chat-models', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { models: roleFilteredFallback }))
      .then((data: { models?: ModelOption[]; llmLiteEnabled?: boolean }) => {
        if (Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
        }
        setLlmLiteEnabled(!!data.llmLiteEnabled);
      })
      .catch(() => {
        setModels(roleFilteredFallback);
      });
  }, [roleFilteredFallback]);

  useEffect(() => {
    let cancelled = false;
    void refreshModels().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const onFocus = () => {
      void refreshModels();
    };
    window.addEventListener('focus', onFocus);

    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshModels();
    }, GATEWAY_MODELS_POLL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(poll);
    };
  }, [refreshModels]);

  return { models, llmLiteEnabled, loading, refreshModels };
}
