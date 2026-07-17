"use client";

import { useEffect, useMemo, useState } from "react";
import { updateQueue } from "@/lib/cunav-api";
import type { AiOutcomeRuleConfig, Queue } from "@/lib/types";
import { AI_OUTCOME_META } from "@/lib/ai-outcomes/registry-meta";

// Matches route-to-togra.ts's ROUTE_TO_TOGRA_TYPE. Not imported from that
// module — see registry-meta.ts's comment on why this file avoids importing
// from outcome-executor modules, which may pull in server-only dependencies.
const ROUTE_TO_TOGRA_TYPE = "route_to_togra";

interface Project {
  id: string;
  name: string;
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
}

interface Props {
  queue: Queue;
  token: string;
  onClose: () => void;
  onSaved: (queue: Queue) => void;
}

/** Per-queue AI triage settings: whether tickets landing here are dispatched to
 *  cunav's AI triage webhook, and — if the AI's confidence clears the threshold —
 *  which Togra project/job/template they're auto-routed into. Mirrors the same
 *  three choices a human picks by hand in SendToTograModal. */
export default function AiQueueSettingsModal({ queue, token, onClose, onSaved }: Props) {
  const [aiEnabled, setAiEnabled] = useState(queue.ai_enabled);
  const [confidence, setConfidence] = useState(queue.ai_route_confidence_threshold);

  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  const [selectedProject, setSelectedProject] = useState(queue.ai_togra_project_id ?? "");
  const [selectedJob, setSelectedJob] = useState(queue.ai_togra_job_id ?? "");
  const [selectedTemplate, setSelectedTemplate] = useState(queue.ai_togra_template_id ?? "");

  // Rule config for every registered outcome type OTHER than route_to_togra
  // (which keeps its bespoke Togra-picker UI below). Rendered generically so a
  // newly-registered outcome type gets a settings row here with no changes to
  // this component — see registry-meta.ts.
  const [otherRuleConfigs, setOtherRuleConfigs] = useState<AiOutcomeRuleConfig[]>(() =>
    (queue.ai_rules ?? []).filter((r) => r.type !== ROUTE_TO_TOGRA_TYPE)
  );

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setProjects(Array.isArray(data) ? data : (data.projects ?? [])))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, [token]);

  useEffect(() => {
    if (!selectedProject) { setJobs([]); return; }
    setLoadingJobs(true);
    fetch(`/api/jobs?project_id=${selectedProject}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        const all: Job[] = Array.isArray(data) ? data : (data.jobs ?? []);
        setJobs(all.filter((j) => j.job_type === "backlog" || j.job_type === "sprint"));
      })
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }, [selectedProject, token]);

  useEffect(() => {
    const project = projects.find((p) => p.id === selectedProject);
    if (!project?.team_id) { setTemplates([]); return; }
    setLoadingTemplates(true);
    fetch(`/api/workflows?team_id=${project.team_id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: (WorkflowTemplate & { is_template?: boolean })[]) => {
        setTemplates((Array.isArray(data) ? data : []).filter((w) => w.is_template));
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, [selectedProject, projects, token]);

  const canSave = !aiEnabled || (!!selectedProject && !!selectedJob);
  const confidencePct = useMemo(() => Math.round(confidence * 100), [confidence]);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const ai_rules: AiOutcomeRuleConfig[] = [
        {
          type: ROUTE_TO_TOGRA_TYPE,
          enabled: aiEnabled && !!selectedProject && !!selectedJob,
          confidence_threshold: confidence,
        },
        ...otherRuleConfigs,
      ];
      const updated = await updateQueue(token, queue.id, {
        ai_enabled: aiEnabled,
        ai_togra_project_id: selectedProject || null,
        ai_togra_job_id: selectedJob || null,
        ai_togra_template_id: selectedTemplate || null,
        ai_route_confidence_threshold: confidence,
        ai_rules,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save AI settings");
    } finally {
      setSaving(false);
    }
  }

  const otherOutcomeMeta = AI_OUTCOME_META.filter((m) => m.type !== ROUTE_TO_TOGRA_TYPE);

  function setOtherRule(type: string, patch: Partial<AiOutcomeRuleConfig>) {
    setOtherRuleConfigs((prev) => {
      const meta = AI_OUTCOME_META.find((m) => m.type === type);
      const existing = prev.find((r) => r.type === type) ?? {
        type,
        enabled: false,
        confidence_threshold: meta?.defaultConfidenceThreshold ?? 0.6,
      };
      return [...prev.filter((r) => r.type !== type), { ...existing, ...patch }];
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-800">AI Triage Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{queue.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)}
              className="rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
            <span className="text-sm font-medium text-slate-700">AI Enabled</span>
          </label>
          <p className="text-xs text-slate-500 -mt-2">
            Tickets landing in this queue are analysed by AI, which posts an analysis note and,
            above the confidence threshold below, auto-creates a matching Togra story.
          </p>

          {aiEnabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Togra project</label>
                {loadingProjects ? (
                  <div className="text-xs text-slate-400">Loading projects…</div>
                ) : (
                  <select value={selectedProject} onChange={(e) => { setSelectedProject(e.target.value); setSelectedJob(""); setSelectedTemplate(""); }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400">
                    <option value="">Select a project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Board / backlog</label>
                <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)} disabled={!selectedProject || loadingJobs}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-60">
                  <option value="">{loadingJobs ? "Loading…" : "Select a board…"}</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Template (optional)</label>
                <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} disabled={!selectedProject || loadingTemplates}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-60">
                  <option value="">No template</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Auto-route confidence threshold: <span className="text-violet-700">{confidencePct}%</span>
                </label>
                <input type="range" min={0} max={1} step={0.05} value={confidence}
                  onChange={(e) => setConfidence(parseFloat(e.target.value))}
                  className="w-full accent-violet-600" />
                <p className="text-xs text-slate-400 mt-1">
                  Below this confidence, the AI only posts its analysis and leaves routing to a human.
                </p>
              </div>

              {otherOutcomeMeta.map((meta) => {
                const config = otherRuleConfigs.find((r) => r.type === meta.type);
                const enabled = config?.enabled ?? false;
                const threshold = config?.confidence_threshold ?? meta.defaultConfidenceThreshold;
                return (
                  <div key={meta.type} className="border-t border-slate-100 pt-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setOtherRule(meta.type, { enabled: e.target.checked })}
                        className="rounded border-slate-300 text-violet-600 focus:ring-violet-400"
                      />
                      <span className="text-sm font-medium text-slate-700">{meta.label}</span>
                    </label>
                    {enabled && (
                      <div className="mt-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Confidence threshold: <span className="text-violet-700">{Math.round(threshold * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={threshold}
                          onChange={(e) => setOtherRule(meta.type, { confidence_threshold: parseFloat(e.target.value) })}
                          className="w-full accent-violet-600"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !canSave}
              className="px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg transition-colors">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
