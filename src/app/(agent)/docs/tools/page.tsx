'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Search, Wrench, ArrowLeft, Filter } from 'lucide-react';
import type { ToolCatalogEntry } from '@/types/catalog';

const TOOL_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'api_call', label: 'API Call' },
  { value: 'db_query', label: 'Database' },
  { value: 'file_op', label: 'File Operation' },
  { value: 'transform', label: 'Transform' },
  { value: 'validation', label: 'Validation' },
  { value: 'custom', label: 'Custom' },
];

const TYPE_COLORS: Record<string, string> = {
  api_call: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  db_query: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  file_op: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  transform: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  validation: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  custom: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300',
};

export default function ToolsListPage() {
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    async function fetchTools() {
      try {
        const res = await fetch('/api/catalog/tools');
        if (res.ok) {
          const data = await res.json();
          setTools(data.items || data);
        }
      } catch (err) {
        console.error('Failed to fetch tools:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchTools();
  }, []);

  const filtered = useMemo(() => {
    return tools.filter(t => {
      const matchSearch =
        !search ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()));
      const matchType = !typeFilter || t.type === typeFilter;
      return matchSearch && matchType;
    });
  }, [tools, search, typeFilter]);

  const groupedByType = useMemo(() => {
    const groups: Record<string, ToolCatalogEntry[]> = {};
    filtered.forEach(tool => {
      const type = tool.type || 'custom';
      if (!groups[type]) groups[type] = [];
      groups[type].push(tool);
    });
    return groups;
  }, [filtered]);

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/docs"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-4"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Docs
        </Link>
        <div className="flex items-center gap-3">
          <Wrench className="h-6 w-6 text-indigo-500" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Tools Library
          </h1>
          <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
            {tools.length} tools
          </span>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-lg">
          Complete reference for all available tools in the Agent Lab platform.
        </p>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-[#2d333b] bg-white dark:bg-[#0d1117] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="pl-8 pr-8 py-2.5 text-xs rounded-lg border border-slate-200 dark:border-[#2d333b] bg-white dark:bg-[#0d1117] text-slate-700 dark:text-slate-300 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            {TOOL_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto" />
          <p className="text-sm text-slate-400 mt-3">Loading tools...</p>
        </div>
      ) : (
        <div className="space-y-10">
          {Object.entries(groupedByType).map(([type, typeTools]) => (
            <section key={type}>
              <div className="flex items-center gap-2 mb-4">
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${TYPE_COLORS[type] || TYPE_COLORS.custom}`}>
                  {type}
                </span>
                <span className="text-xs text-slate-400">{typeTools.length} tools</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {typeTools.map(tool => (
                  <Link
                    key={tool.id}
                    href={`/docs/tools/${tool.slug}`}
                    className="group p-4 rounded-lg border border-slate-200 dark:border-[#2d333b] hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-[#161b22] transition-all hover:shadow-md"
                  >
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate mb-1.5">
                      {tool.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-3">
                      {tool.description || 'No description'}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {(tool.tags || []).slice(0, 2).map(tag => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">v{tool.version}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-12">No tools match your search criteria.</p>
          )}
        </div>
      )}
    </div>
  );
}
