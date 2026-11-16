export function DeliveryDate({ value, previous, asOfDate, format, changedLabel, overdueLabel }: {
  value?: string | null; previous?: string | null; asOfDate: string;
  format: (value?: string | null) => string; changedLabel: string; overdueLabel: string;
}) {
  const changed = Boolean(value && previous && value !== previous);
  const overdue = Boolean(value && value < asOfDate);
  const explanation = [changed ? changedLabel : '', overdue ? overdueLabel : ''].filter(Boolean).join(' · ');
  return <span className={changed || overdue ? 'delivery-date-alert' : undefined} title={explanation || undefined}>
    {format(value)}{explanation && <small className="delivery-date-reason">{explanation}</small>}
  </span>;
}
