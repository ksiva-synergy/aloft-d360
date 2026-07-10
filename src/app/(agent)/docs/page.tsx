'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Search, Wrench, Bot, BookOpen, Filter } from 'lucide-react';
import type { ToolCatalogEntry, AgentCatalogEntry } from '@/types/catalog';

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
  orchestrator: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  worker: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  planner: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  validator: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  router: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

export default function DocsHubPage() {
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeSection, setActiveSection] = useState<'all' | 'tools' | 'agents'>('all');

  useEffect(() => {
    async function fetchData() {
      try {
        const [toolsRes, agentsRes] = await Promise.all([
          fetch('/api/catalog/tools'),
          fetch('/api/catalog/agents'),
        ]);
        if (toolsRes.ok) {
          const data = await toolsRes.json();
          setTools(data.items || data);
        }
        if (agentsRes.ok) {
          const data = await agentsRes.json();
          setAgents(data.items || data);
        }
      } catch (err) {
        console.error('Failed to fetch catalog data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const filteredTools = useMemo(() => {
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

  const filteredAgents = useMemo(() => {
    return agents.filter(a => {
      const matchSearch =
        !search ||
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        (a.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (a.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()));
      const matchType = !typeFilter || a.type === typeFilter;
      return matchSearch && matchType;
    });
  }, [agents, search, typeFilter]);

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-xs font-medium mb-4">
          <BookOpen className="h-3.5 w-3.5" />
          Documentation
        </div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
          Tools & Agents Library
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
          Browse the complete catalog of tools and agents available in the Agent Lab platform.
        </p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search tools and agents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-[#2d333b] bg-white dark:bg-[#0d1117] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
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
          <div className="flex rounded-lg border border-slate-200 dark:border-[#2d333b] overflow-hidden">
            {(['all', 'tools', 'agents'] as const).map(section => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  activeSection === section
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-[#0d1117] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {section}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto" />
          <p className="text-sm text-slate-400 mt-3">Loading catalog...</p>
        </div>
      ) : (
        <>
          {/* Tools Section */}
          {(activeSection === 'all' || activeSection === 'tools') && (
            <section className="mb-12">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-indigo-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Tools
                  </h2>
                  <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {filteredTools.length}
                  </span>
                </div>
                <Link
                  href="/docs/tools"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  View all
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTools.slice(0, activeSection === 'all' ? 6 : undefined).map(tool => (
                  <Link
                    key={tool.id}
                    href={`/docs/tools/${tool.slug}`}
                    className="group p-4 rounded-lg border border-slate-200 dark:border-[#2d333b] hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-[#161b22] transition-all hover:shadow-md"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                        {tool.name}
                      </h3>
                      <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${TYPE_COLORS[tool.type] || TYPE_COLORS.custom} shrink-0 ml-2`}>
                        {tool.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-3">
                      {tool.description || 'No description'}
                    </p>
                    {tool.tags && tool.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tool.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            {tag}
                          </span>
                        ))}
                        {tool.tags.length > 3 && (
                          <span className="text-[9px] text-slate-400">+{tool.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
              {filteredTools.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No tools match your search criteria.</p>
              )}
            </section>
          )}

          {/* Agents Section */}
          {(activeSection === 'all' || activeSection === 'agents') && (
            <section className="mb-12">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-violet-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Agents
                  </h2>
                  <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {filteredAgents.length}
                  </span>
                </div>
                <Link
                  href="/docs/agents"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  View all
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredAgents.slice(0, activeSection === 'all' ? 6 : undefined).map(agent => (
                  <Link
                    key={agent.id}
                    href={`/docs/agents/${agent.slug}`}
                    className="group p-4 rounded-lg border border-slate-200 dark:border-[#2d333b] hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-[#161b22] transition-all hover:shadow-md"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 truncate">
                        {agent.name}
                      </h3>
                      <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${TYPE_COLORS[agent.type] || 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300'} shrink-0 ml-2`}>
                        {agent.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-3">
                      {agent.description || 'No description'}
                    </p>
                    {agent.tags && agent.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {agent.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            {tag}
                          </span>
                        ))}
                        {agent.tags.length > 3 && (
                          <span className="text-[9px] text-slate-400">+{agent.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
              {filteredAgents.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No agents match your search criteria.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
