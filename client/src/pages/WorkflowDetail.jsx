import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../api/client';
import Badge from '../components/Badge';
import { cronIntervalError } from '../lib/cron';

const ACTION_TYPES = ['HTTP_REQUEST', 'TRANSFORM', 'DELAY', 'LOG'];

const WEBHOOK_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4200/api').replace(/\/api\/?$/, '');

function StepConfigSummary({ step }) {
  const c = step.config;
  if (step.actionType === 'HTTP_REQUEST') {
    return (
      <span className="font-mono text-xs text-slate-500">
        {c.method || 'GET'} {c.url}
      </span>
    );
  }
  if (step.actionType === 'TRANSFORM') {
    return <span className="font-mono text-xs text-slate-500">{JSON.stringify(c.template)}</span>;
  }
  if (step.actionType === 'DELAY') {
    return <span className="font-mono text-xs text-slate-500">wait {c.seconds}s</span>;
  }
  if (step.actionType === 'LOG') {
    return <span className="font-mono text-xs text-slate-500">"{c.message}"</span>;
  }
  return null;
}

function AddStepForm({ workflowId, onAdded, onClose }) {
  const [actionType, setActionType] = useState('LOG');
  const [url, setUrl] = useState('https://httpbin.org/post');
  const [method, setMethod] = useState('POST');
  const [body, setBody] = useState('{}');
  const [template, setTemplate] = useState('{}');
  const [seconds, setSeconds] = useState(2);
  const [message, setMessage] = useState('Step ran for {{name}}');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    let config = {};
    try {
      if (actionType === 'HTTP_REQUEST') {
        config = { url, method, body: body.trim() ? JSON.parse(body) : undefined };
      } else if (actionType === 'TRANSFORM') {
        config = { template: JSON.parse(template) };
      } else if (actionType === 'DELAY') {
        config = { seconds: Number(seconds) };
      } else if (actionType === 'LOG') {
        config = { message };
      }
    } catch {
      setError('Invalid JSON in one of the fields');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/workflows/${workflowId}/steps`, { actionType, config });
      onAdded();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add step');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-lg border border-dashed border-slate-300 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">Add step</h3>
      <label className="mb-1 block text-xs font-medium text-slate-600">Action type</label>
      <select
        value={actionType}
        onChange={(e) => setActionType(e.target.value)}
        className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {ACTION_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {actionType === 'HTTP_REQUEST' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-28 rounded-lg border border-slate-300 px-2 py-2 text-sm"
            >
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>DELETE</option>
            </select>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://httpbin.org/post"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder='{"field": "{{payloadField}}"}'
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-slate-400">
            Outbound requests are validated server-side to block private/internal IPs (SSRF protection) — only
            public http/https URLs will succeed.
          </p>
        </div>
      )}

      {actionType === 'TRANSFORM' && (
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={3}
          placeholder='{"newField": "{{oldField}}"}'
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
        />
      )}

      {actionType === 'DELAY' && (
        <div>
          <input
            type="number"
            min={0}
            max={60}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-400">Clamped server-side to a max of 10 seconds.</p>
        </div>
      )}

      {actionType === 'LOG' && (
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      )}

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Adding…' : 'Add step'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function WorkflowDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [runs, setRuns] = useState([]);
  const [showAddStep, setShowAddStep] = useState(false);
  const [cronDraft, setCronDraft] = useState('');
  const [cronError, setCronError] = useState('');
  const [runError, setRunError] = useState('');
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  const loadWorkflow = useCallback(async () => {
    const res = await api.get(`/workflows/${id}`);
    setWorkflow(res.data);
    setCronDraft(res.data.cronExpression || '');
  }, [id]);

  const loadRuns = useCallback(async () => {
    const res = await api.get(`/workflows/${id}/runs`);
    setRuns(res.data);
    return res.data;
  }, [id]);

  useEffect(() => {
    loadWorkflow();
    loadRuns();
  }, [loadWorkflow, loadRuns]);

  // Poll every 2s while a run is in-flight so status/duration update live.
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'RUNNING');
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(loadRuns, 2000);
    }
    if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [runs, loadRuns]);

  async function handleRunNow() {
    setRunError('');
    setRunning(true);
    try {
      await api.post(`/workflows/${id}/run`, { payload: {} });
      await loadRuns();
    } catch (err) {
      setRunError(err.response?.data?.error || 'Run failed to start');
    } finally {
      setRunning(false);
    }
  }

  async function handleToggleActive() {
    const res = await api.patch(`/workflows/${id}`, { isActive: !workflow.isActive });
    setWorkflow(res.data);
  }

  async function handleSaveCron() {
    const err = cronIntervalError(cronDraft);
    if (err) return setCronError(err);
    setCronError('');
    try {
      const res = await api.patch(`/workflows/${id}`, { cronExpression: cronDraft });
      setWorkflow(res.data);
    } catch (err) {
      setCronError(err.response?.data?.error || 'Could not save cron expression');
    }
  }

  async function handleMove(stepId, direction) {
    await api.post(`/workflows/${id}/steps/${stepId}/move`, { direction });
    loadWorkflow();
  }

  async function handleRemoveStep(stepId) {
    await api.delete(`/workflows/${id}/steps/${stepId}`);
    loadWorkflow();
  }

  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!workflow) return <div className="text-sm text-slate-400">Loading…</div>;

  const webhookUrl = `${WEBHOOK_ORIGIN}/api/hooks/${workflow.id}/${workflow.webhookToken}`;
  const curlCommand = `curl -X POST ${webhookUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "Ada Lovelace", "email": "ada@example.com"}'`;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">
        ← All workflows
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{workflow.name}</h1>
          {workflow.description && <p className="mt-1 text-sm text-slate-500">{workflow.description}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Badge status={workflow.triggerType} />
          <button
            onClick={handleToggleActive}
            className={`relative h-6 w-11 rounded-full transition ${workflow.isActive ? 'bg-brand-600' : 'bg-slate-200'}`}
            aria-label="Toggle active"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                workflow.isActive ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Trigger config */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Trigger</h2>

        {workflow.triggerType === 'WEBHOOK' && (
          <div>
            <p className="mb-2 text-sm text-slate-600">
              This is a live public endpoint. POST to it from anywhere and a run will appear below.
            </p>
            <div className="rounded-lg bg-slate-900 p-3">
              <pre className="whitespace-pre-wrap break-all text-xs text-emerald-300">{curlCommand}</pre>
            </div>
            <button
              onClick={() => copyText(curlCommand)}
              className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              {copied ? 'Copied!' : 'Copy curl command'}
            </button>
          </div>
        )}

        {workflow.triggerType === 'SCHEDULE' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Cron expression (minimum 5-minute interval enforced)
            </label>
            <div className="flex gap-2">
              <input
                value={cronDraft}
                onChange={(e) => setCronDraft(e.target.value)}
                className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={handleSaveCron}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Save
              </button>
            </div>
            {cronError && <p className="mt-2 text-sm text-rose-600">{cronError}</p>}
            <p className="mt-2 text-xs text-slate-400">
              Runs automatically via node-cron while the workflow is active.
            </p>
          </div>
        )}

        {workflow.triggerType === 'MANUAL' && (
          <div>
            <button
              onClick={handleRunNow}
              disabled={running}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {running ? 'Starting…' : 'Run now'}
            </button>
            {runError && <p className="mt-2 text-sm text-rose-600">{runError}</p>}
          </div>
        )}
      </div>

      {/* Steps builder */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Steps</h2>
          {!showAddStep && (
            <button
              onClick={() => setShowAddStep(true)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              + Add step
            </button>
          )}
        </div>

        <ol className="mt-3 space-y-2">
          {workflow.steps.map((step, idx) => (
            <li
              key={step.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{step.actionType}</div>
                  <div className="truncate">
                    <StepConfigSummary step={step} />
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => handleMove(step.id, 'up')}
                  disabled={idx === 0}
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-white disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => handleMove(step.id, 'down')}
                  disabled={idx === workflow.steps.length - 1}
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-white disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => handleRemoveStep(step.id)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  aria-label="Remove step"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {workflow.steps.length === 0 && <p className="text-sm text-slate-400">No steps yet.</p>}
        </ol>

        {showAddStep && (
          <AddStepForm
            workflowId={workflow.id}
            onClose={() => setShowAddStep(false)}
            onAdded={() => {
              setShowAddStep(false);
              loadWorkflow();
            }}
          />
        )}
      </div>

      {/* Run history */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Run history</h2>
          <span className="text-xs text-slate-400">{runs.length} run(s)</span>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Trigger</th>
                <th className="px-5 py-2">Duration</th>
                <th className="px-5 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-slate-400" colSpan={4}>
                    No runs yet — trigger this workflow to see history here.
                  </td>
                </tr>
              )}
              {runs.map((run) => {
                const durationMs = run.finishedAt
                  ? new Date(run.finishedAt) - new Date(run.startedAt)
                  : null;
                return (
                  <tr
                    key={run.id}
                    onClick={() => navigate(`/workflows/${workflow.id}/runs/${run.id}`)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-5 py-3">
                      <Badge status={run.status} />
                    </td>
                    <td className="px-5 py-3">
                      <Badge status={run.trigger} />
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {durationMs !== null ? `${durationMs}ms` : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {format(new Date(run.startedAt), 'MMM d, HH:mm:ss')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
