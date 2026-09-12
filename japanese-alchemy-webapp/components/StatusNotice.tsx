import type { ReactNode } from 'react';

/**
 * P6.5-C — visually distinct "informational, not an error" notice.
 * Uses theme tokens only (secondary/foreground), so it adapts automatically
 * in dark mode without any hardcoded colors.
 */
export function StatusNotice({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-secondary bg-secondary/20 px-4 py-3 text-left text-sm">
      {title && <p className="font-semibold text-foreground">{title}</p>}
      <div className={title ? 'mt-1 text-muted-foreground' : 'text-muted-foreground'}>
        {children}
      </div>
    </div>
  );
}
