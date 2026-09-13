import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Badge from '../components/Badge';
import { cronIntervalError } from '../lib/cron';

const TRIGGER_LABELS = { WEBHOOK: 'Webhook', SCHEDULE: 'Schedule', MANUAL: 'Manual' };

function NewWorkflowForm({ onCreated, onClose }) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState('MANUAL');
  const [cronExpression, setCronExpression] = useState('*/15 * * * *');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (triggerType === 'SCHEDULE') {
      const cronError = cronIntervalError(cronExpression);
      if (cronError) return setError(cronError);
    }
    setSaving(true);
    try {
      const res = await api.post('/workflows', {
        name,
        triggerType,
        cronExpression: triggerType === 'SCHEDULE' ? cronExpression : undefined,
      });
      onCreated(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create workflow');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-3 text-sm font-semibold text-slate-800">New workflow</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Support ticket sync"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Trigger</label>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="MANUAL">Manual</option>
            <option value="WEBHOOK">Webhook</option>
            <option value="SCHEDULE">Schedule</option>
          </select>
        </div>
        {triggerType === 'SCHEDULE' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Cron expression (min 5 min interval)
            </label>
            <input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Creating…' : 'Create workflow'}
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

export default function WorkflowList() {
  const [workflows, setWorkflows] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await api.get('/workflows');
      setWorkflows(res.data);
    } catch {
      setError('Could not load workflows');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(workflow) {
    const res = await api.patch(`/workflows/${workflow.id}`, { isActive: !workflow.isActive });
    setWorkflows((prev) => prev.map((w) => (w.id === workflow.id ? res.data : w)));
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Workflows</h1>
          <p className="mt-1 text-sm text-slate-500">
            Triggers, steps, and run history for Fieldstream's automations.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New workflow
          </button>
        )}
      </div>

      {showForm && (
        <NewWorkflowForm
          onClose={() => setShowForm(false)}
          onCreated={(wf) => {
            setWorkflows((prev) => [wf, ...(prev || [])]);
            setShowForm(false);
          }}
        />
      )}

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">Steps</th>
              <th className="px-4 py-3">Last run</th>
              <th className="px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody>
            {workflows === null && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {workflows?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  No workflows yet — create one above.
                </td>
              </tr>
            )}
            {workflows?.map((wf) => (
              <tr key={wf.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/workflows/${wf.id}`} className="font-medium text-brand-700 hover:underline">
                    {wf.name}
                  </Link>
                  {wf.description && (
                    <div className="mt-0.5 max-w-md text-xs text-slate-500">{wf.description}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge status={wf.triggerType} />
                  {wf.triggerType === 'SCHEDULE' && wf.cronExpression && (
                    <div className="mt-1 font-mono text-xs text-slate-400">{wf.cronExpression}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{wf.steps.length}</td>
                <td className="px-4 py-3">
                  {wf.lastRun ? <Badge status={wf.lastRun.status} /> : <span className="text-slate-400">Never run</span>}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(wf)}
                    className={`relative h-6 w-11 rounded-full transition ${
                      wf.isActive ? 'bg-brand-600' : 'bg-slate-200'
                    }`}
                    aria-label="Toggle active"
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                        wf.isActive ? 'left-5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
