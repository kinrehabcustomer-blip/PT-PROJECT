export function StatCard({
  label,
  value,
  caption,
  icon,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  icon: string;
  tone: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top"><span className="stat-label">{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div>
      <div className="stat-value">{value}</div>
      <div className="stat-caption">{caption}</div>
    </article>
  );
}
