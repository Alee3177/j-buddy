import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/StatusNotice';

export interface EmptyStateAction {
  label: string;
  href: string;
}

export interface EmptyStateNotice {
  title?: string;
  body: ReactNode;
}

export function EmptyState({
  title,
  description,
  notice,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** A visually distinct, non-alarming status notice (e.g. extension availability). */
  notice?: EmptyStateNotice;
  action?: EmptyStateAction;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="py-8 text-center space-y-3">
        <p className="text-gray-500">{title}</p>
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
        {notice && (
          <StatusNotice title={notice.title}>{notice.body}</StatusNotice>
        )}
        {action && (
          <div className="pt-2">
            <Button asChild variant="default" size="sm">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
