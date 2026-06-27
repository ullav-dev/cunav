"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Ticket } from "@/lib/types";

interface Project {
  id: string;
  name: string;
  description?: string | null;
  team_id?: string | null;
}

interface Job {
  id: string;
  name: string;
  job_type: string;
  project_id: string | null;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
}

interface Props {
  ticket: Ticket;
  onClose: () => void;
  onSent: (tograWorkflowId: string, tograProjectId: string, projectName: string, jobName: string) => void;
}

export default function SendToTograModal({ ticket, onClose, onSent }: Props) {
  const { token } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null); // null = None
  const [noTemplate, setNoTemplate] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Load projects
  useEffect(() => {
    if (!token) return;
    fetch("/api/projects", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const list: Project[] = Array.isArray(data) ? data : (data.projects ?? []);
        setProjects(list);
        if (list.length === 0) setProjectsError("No Togra projects found. Your team may need Obair access.");
      })
      .catch(() => setProjectsError("Could not load Togra projects."))
      .finally(() => setLoadingProjects(false));
  }, [token]);

  // Load jobs when project changes
  useEffect(() => {
    setJobs([]); setSelectedJob(""); // clear immediately to avoid stale job from previous project
    if (!selectedProject || !token) return;
    setLoadingJobs(true);
    fetch(`/api/jobs?project_id=${selectedProject}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const all: Job[] = Array.isArray(data) ? data : (data.jobs ?? []);
        const list = all
          .filter((j) => j.job_type === "backlog" || j.job_type === "sprint")
          .sort((a, b) => (a.job_type === "backlog" ? -1 : 1) - (b.job_type === "backlog" ? -1 : 1));
        setJobs(list);
        const backlog = list.find((j) => j.job_type === "backlog");
        if (backlog) setSelectedJob(backlog.id);
        else if (list.length > 0) setSelectedJob(list[0].id);
        else setSelectedJob("");
      })
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }, [selectedProject, token]);

  // Load templates when project changes (scoped to project's team)
  useEffect(() => {
    setTemplates([]); setSelectedTemplate(null); setNoTemplate(false);
    const project = projects.find((p) => p.id === selectedProject);
    const teamId = project?.team_id;
    if (!teamId || !token) { return; }
    setLoadingTemplates(true);
    fetch(`/api/workflows?team_id=${teamId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: (WorkflowTemplate & { is_template?: boolean })[]) => {
        const list = (Array.isArray(data) ? data : []).filter((w) => w.is_template) as WorkflowTemplate[];
        setTemplates(list);
        // Auto-select a template matching the ticket type
        const hint = ticket.ticket_type ?? "";
        const matchMap: Record<string, string[]> = {
          feature:     ["story", "feature"],
          bug:         ["bug", "defect", "fix"],
          task:        ["task"],
          improvement: ["improvement", "enhancement"],
          question:    ["question", "support"],
        };
        const keywords = matchMap[hint] ?? [];
        const match = list.find((t) =>
          keywords.some((k) => t.name.toLowerCase().includes(k))
        );
        setSelectedTemplate(match?.id ?? (list[0]?.id ?? null));
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, projects, token]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    return q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates;
  }, [templates, templateSearch]);

  async function handleSend() {
    if (!token || !selectedProject || !selectedJob) return;
    setSending(true); setError(null);
    try {
      const cunávUrl = window.location.origin;
      const backlink = `\n\n---\n*Cunav ticket: [${ticket.name}](${cunávUrl}/en/tickets/${ticket.id})*`;
      const enrichedDescription = (ticket.description ?? "") + backlink;

      let created;
      if (!noTemplate && selectedTemplate) {
        const res = await fetch(`/api/jobs/${selectedJob}/workflows/from-template/${selectedTemplate}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        created = await res.json();
        // Rename, enrich description, set type/priority/visibility to match ticket
        const patch = await fetch(`/api/workflows/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: ticket.name,
            description: enrichedDescription,
            ticket_type: ticket.ticket_type ?? undefined,
            priority: ticket.priority ?? undefined,
            is_shared: true,
          }),
        });
        if (!patch.ok) throw new Error(`Patch failed: HTTP ${patch.status}`);
        created = await patch.json();
      } else {
        const res = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: ticket.name,
            description: enrichedDescription,
            job_id: selectedJob,
            is_shared: true,
            ticket_type: ticket.ticket_type ?? undefined,
            priority: ticket.priority ?? undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        created = await res.json();
      }
      const project = projects.find((p) => p.id === selectedProject);
      const job = jobs.find((j) => j.id === selectedJob);
      // Use the job's own project_id as the authoritative cross-reference, not selectedProject
      const actualProjectId = job?.project_id ?? selectedProject;
      onSent(created.id, actualProjectId, project?.name ?? "Togra", job?.name ?? "backlog");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to Togra");
    } finally {
      setSending(false);
    }
  }

  const canSend = !!selectedProject && !!selectedJob && (noTemplate || !!selectedTemplate || templates.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Send to Togra</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{ticket.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {loadingProjects ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            </div>
          ) : projectsError ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">{projectsError}</p>
          ) : (
            <>
              {/* Project */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Togra project</label>
                <select
                  value={selectedProject}
                  onChange={(e) => { setSelectedProject(e.target.value); setTemplateSearch(""); }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  <option value="">— select a project —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Backlog / sprint */}
              {selectedProject && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Backlog / sprint</label>
                  {loadingJobs ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-4 h-4 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                      <span className="text-xs text-slate-400">Loading…</span>
                    </div>
                  ) : jobs.length === 0 ? (
                    <p className="text-xs text-slate-400">No backlog or sprint found in this project.</p>
                  ) : (
                    <select
                      value={selectedJob}
                      onChange={(e) => setSelectedJob(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                    >
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>{j.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Workflow template */}
              {selectedProject && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Workflow template</label>
                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-4 h-4 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                      <span className="text-xs text-slate-400">Loading templates…</span>
                    </div>
                  ) : templates.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No templates defined for this project&apos;s team — workflow will be created blank.</p>
                  ) : (
                    <>
                      {/* Searchable combobox */}
                      <div className="relative">
                        <input
                          value={noTemplate ? "" : templateOpen ? templateSearch : (templates.find(t => t.id === selectedTemplate)?.name ?? "")}
                          onChange={(e) => { setTemplateSearch(e.target.value); setTemplateOpen(true); }}
                          onFocus={() => { setTemplateSearch(""); setTemplateOpen(true); }}
                          onBlur={() => setTimeout(() => setTemplateOpen(false), 150)}
                          placeholder="— select a template —"
                          disabled={noTemplate}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-8 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-40 disabled:bg-slate-50"
                        />
                        <svg viewBox="0 0 16 16" fill="currentColor" className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none">
                          <path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"/>
                        </svg>
                        {templateOpen && (
                          <div className="absolute z-10 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {filteredTemplates.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-slate-400">No templates match.</p>
                            ) : filteredTemplates.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onMouseDown={() => { setSelectedTemplate(t.id); setTemplateOpen(false); setTemplateSearch(""); }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${selectedTemplate === t.id ? "bg-violet-50 text-violet-800" : "text-slate-800"}`}
                              >
                                <p className="font-medium truncate">{t.name}</p>
                                {t.description && <p className="text-xs text-slate-400 truncate">{t.description}</p>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* None option */}
                      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={noTemplate}
                          onChange={(e) => { setNoTemplate(e.target.checked); setTemplateOpen(false); setTemplateSearch(""); }}
                          className="accent-violet-600"
                        />
                        <span className="text-xs text-slate-500">Send without a template (blank workflow)</span>
                      </label>
                    </>
                  )}
                </div>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !canSend}
            className="text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {sending ? "Sending…" : "Send to Togra"}
          </button>
        </div>
      </div>
    </div>
  );
}
