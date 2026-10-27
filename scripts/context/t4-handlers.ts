/**
 * T4 semantic bootstrap — orchestrator entry points.
 * Re-implements scan → entity-propose → dim-propose (T2-driven heuristics).
 */
export {
  runT4Scan,
  runT4EntityPropose,
  runT4DimPropose,
} from '@/lib/context/t4/run';
