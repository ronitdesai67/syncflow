export default function StatCard({ label, value, sublabel, accent = 'brand' }) {
  const accents = {
    brand: 'text-brand-600 bg-brand-50',
    green: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    rose: 'text-rose-600 bg-rose-50',
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-slate-900">{value}</span>
      </div>
      {sublabel && (
        <div className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${accents[accent]}`}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
