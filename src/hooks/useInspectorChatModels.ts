'use client';

import { useEffect, useState } from 'react';
import { AVAILABLE_MODELS, type ModelOption } from '@/components/agent-lab/workbench/types';

export function useInspectorChatModels() {
  const [models, setModels] = useState<ModelOption[]>(AVAILABLE_MODELS);
  const [llmLiteEnabled, setLlmLiteEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/inspector/chat-models')
      .then((r) => (r.ok ? r.json() : { models: AVAILABLE_MODELS }))
      .then((data: { models?: ModelOption[]; llmLiteEnabled?: boolean }) => {
        if (cancelled) return;
        if (Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
        }
        setLlmLiteEnabled(!!data.llmLiteEnabled);
      })
      .catch(() => {
        if (!cancelled) setModels(AVAILABLE_MODELS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, llmLiteEnabled, loading };
}
