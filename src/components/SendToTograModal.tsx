"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Ticket } from "@/lib/types";

interface Project {
  id: string;
  name: string;
  description?: string | null;
}

interface Job {
  id: string;
  name: string;
  job_type: string;
}

interface Props {
  ticket: Ticket;
  onClose: () => void;
  onSent: (tograWorkflowId: string, projectName: string, jobName: string) => void;
}

export default function SendToTograModal({ ticket, onClose, onSent }: Props) {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/projects", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const list: Project[] = Array.isArray(data) ? data : (data.projects ?? []);
        setProjects(list);
        if (list.length === 0) setProjectsError("No Togra projects found. Your team may need Obair access to see projects.");
      })
      .catch(() => setProjectsError("Could not load Togra projects."))
      .finally(() => setLoadingProjects(false));
  }, [token]);

  useEffect(() => {
    if (!selectedProject || !token) { setJobs([]); setSelectedJob(""); return; }
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
      })
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }, [selectedProject, token]);

  async function handleSend() {
    if (!token || !selectedProject || !selectedJob) return;
    setSending(true); setError(null);
    try {
      const body = {
        name: ticket.name,
        description: ticket.description ?? "",
        job_id: selectedJob,
        is_shared: true,
      };
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      const project = projects.find((p) => p.id === selectedProject);
      const job = jobs.find((j) => j.id === selectedJob);
      onSent(created.id, project?.name ?? "Togra", job?.name ?? "backlog");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to Togra");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Send to Togra</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{ticket.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
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
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Togra project</label>
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  <option value="">— select a project —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {selectedProject && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Backlog / sprint</label>
                  {loadingJobs ? (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-4 h-4 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                      <span className="text-xs text-slate-400">Loading backlogs…</span>
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

              {error && <p className="text-xs text-red-600">{error}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !selectedProject || !selectedJob}
            className="text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {sending ? "Sending…" : "Send to Togra"}
          </button>
        </div>
      </div>
    </div>
  );
}
