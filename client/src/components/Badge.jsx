const STYLES = {
  SUCCESS: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
  RUNNING: 'bg-sky-50 text-sky-700',
  SKIPPED: 'bg-slate-100 text-slate-500',
  WEBHOOK: 'bg-violet-50 text-violet-700',
  SCHEDULE: 'bg-amber-50 text-amber-700',
  MANUAL: 'bg-sky-50 text-sky-700',
};

export default function Badge({ status }) {
  const style = STYLES[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status?.replace('_', ' ')}
    </span>
  );
}
