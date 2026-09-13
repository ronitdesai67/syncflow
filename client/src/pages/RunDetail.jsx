import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../api/client';
import Badge from '../components/Badge';

export default function RunDetail() {
  const { id, runId } = useParams();
  const [run, setRun] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    const res = await api.get(`/workflows/${id}/runs/${runId}`);
    setRun(res.data);
    return res.data;
  }, [id, runId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 2s while the run is still in-flight.
  useEffect(() => {
    if (run?.status === 'RUNNING' && !pollRef.current) {
      pollRef.current = setInterval(load, 2000);
    }
    if (run && run.status !== 'RUNNING' && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [run, load]);

  if (!run) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={`/workflows/${id}`} className="text-sm text-slate-500 hover:text-slate-700">
        ← Back to workflow
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Run detail</h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{run.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge status={run.status} />
          <Badge status={run.trigger} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Started</div>
          <div className="mt-1 text-sm text-slate-800">{format(new Date(run.startedAt), 'MMM d, yyyy HH:mm:ss')}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Finished</div>
          <div className="mt-1 text-sm text-slate-800">
            {run.finishedAt ? format(new Date(run.finishedAt), 'MMM d, yyyy HH:mm:ss') : 'In progress…'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Input payload</div>
          <div className="mt-1 truncate font-mono text-xs text-slate-600">
            {JSON.stringify(run.inputPayload)}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Step logs</h2>
        </div>
        <ol className="divide-y divide-slate-100">
          {run.stepLogs.map((log) => (
            <li key={log.id} className="px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                    {log.stepOrder + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-800">{log.actionType}</span>
                  <Badge status={log.status} />
                </div>
                <span className="text-xs text-slate-400">{log.durationMs}ms</span>
              </div>
              {log.error && (
                <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{log.error}</p>
              )}
              {!log.error && Object.keys(log.output || {}).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-300">
                  {JSON.stringify(log.output, null, 2)}
                </pre>
              )}
            </li>
          ))}
          {run.stepLogs.length === 0 && (
            <li className="px-5 py-6 text-sm text-slate-400">No step logs yet.</li>
          )}
        </ol>
      </div>
    </div>
  );
}
