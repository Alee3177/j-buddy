'use client';

/**
 * Japanese Reader v0.4 — read-only presentation for the "學習項目" tab.
 *
 * P2.2: renders raw saved occurrences newest-first, one card each — no grouping,
 * no edit/delete, no filter/search.
 * P3.4: an optional per-card "加入複習" action.
 * P4.4: "已加入複習" state is driven by `reviewedKeys` (the set of lexicalKeys
 * that already have a review card), so every duplicate occurrence of the same
 * word shows the same state and it survives a reload. Add-in-flight state is
 * tracked per `lexicalKey`, so clicking one 改善 card disables every 改善 button.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/EmptyState';
import { parseFurigana, safeExternalUrl } from '@/lib/textUtils';
import type { LearningItem } from '@/types';
import type { LearningItemsFeedState } from '@/lib/learningItemsFeed';

function LearningItemCard({
  item,
  addControl,
}: {
  item: LearningItem;
  addControl: ReactNode;
}) {
  const sourceUrl = safeExternalUrl(item.sourceUrl);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {item.type === 'vocab' ? '單字' : '文法'}
          </Badge>
          <CardTitle
            className="text-lg"
            dangerouslySetInnerHTML={{ __html: parseFurigana(item.surface) }}
          />
        </div>
        <CardDescription>
          {new Date(item.createdAt).toLocaleDateString('zh-TW')}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-primary hover:underline"
            >
              來源
            </a>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {item.reading && (
          <p className="text-muted-foreground">{item.reading}</p>
        )}
        {item.meaning && (
          <p dangerouslySetInnerHTML={{ __html: parseFurigana(item.meaning) }} />
        )}
        {item.sourceSentence && (
          <p
            className="text-muted-foreground"
            dangerouslySetInnerHTML={{
              __html: parseFurigana(item.sourceSentence),
            }}
          />
        )}
        {addControl && <div className="pt-2">{addControl}</div>}
      </CardContent>
    </Card>
  );
}

export function LearningItemsPanel({
  state,
  onLoadMore,
  onAddToReview,
  reviewedKeys,
  reviewKeysLoading = false,
  reviewKeysError = false,
}: {
  state: LearningItemsFeedState;
  onLoadMore: () => void;
  onAddToReview?: (item: LearningItem) => Promise<unknown>;
  /** lexicalKeys that already have a review card (P4.4) */
  reviewedKeys?: ReadonlySet<string>;
  /** the reviewed-key set is still loading — hide add controls until it resolves */
  reviewKeysLoading?: boolean;
  /** the reviewed-key set failed to load — show add controls anyway (idempotent) */
  reviewKeysError?: boolean;
}) {
  // Add requests in flight, keyed by lexicalKey — one 改善 click disables every
  // 改善 button. `failedKeys` tracks the most recent per-key failure for a hint.
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  const handleAdd = useCallback(
    async (item: LearningItem) => {
      if (!onAddToReview) return;
      const key = item.lexicalKey;
      setPendingKeys((prev) => new Set(prev).add(key));
      setFailedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      try {
        await onAddToReview(item);
        // On success the parent adds `key` to `reviewedKeys`; the cards then
        // re-render as 已加入複習 on their own.
      } catch {
        setFailedKeys((prev) => new Set(prev).add(key));
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [onAddToReview]
  );

  if (state.phase === 'loading') {
    return (
      <p className="py-8 text-center text-muted-foreground">載入中...</p>
    );
  }

  if (state.phase === 'error') {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-gray-500">無法載入學習項目，請稍後再試。</p>
        </CardContent>
      </Card>
    );
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        title="還沒有學習項目"
        description={<p>儲存日文分析內容後，單字與文法會出現在這裡。</p>}
        notice={{ body: 'Chrome Extension 整合功能目前正在準備中。' }}
        action={{ label: '查看如何使用', href: '/how-to-use' }}
      />
    );
  }

  // Add controls are shown only when a handler is wired AND the reviewed-key
  // set has resolved (loaded or errored) — never while it is still loading, to
  // avoid briefly showing 加入複習 on an item that is already in review.
  const showAddControls = onAddToReview != null && !reviewKeysLoading;

  const addControlFor = (item: LearningItem): ReactNode => {
    if (!showAddControls) return null;
    if (reviewedKeys?.has(item.lexicalKey)) {
      return <span className="text-xs text-muted-foreground">已加入複習</span>;
    }
    const pending = pendingKeys.has(item.lexicalKey);
    const failed = failedKeys.has(item.lexicalKey);
    return (
      <span className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void handleAdd(item)}
        >
          加入複習
        </Button>
        {failed && (
          <span className="text-xs text-gray-500">加入失敗，請再試一次</span>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {onAddToReview != null && reviewKeysError && (
        <p className="text-center text-sm text-gray-500">
          無法載入複習狀態，「加入複習」仍可使用。
        </p>
      )}

      <div className="grid gap-4">
        {state.items.map((item) => (
          <LearningItemCard
            key={item.id}
            item={item}
            addControl={addControlFor(item)}
          />
        ))}
      </div>

      {state.cursor != null && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={state.loadingMore}
          >
            {state.loadingMore ? '載入中...' : '載入更多'}
          </Button>
        </div>
      )}

      {state.loadMoreFailed && (
        <p className="text-center text-sm text-gray-500">
          載入更多時發生錯誤，請再試一次。
        </p>
      )}
    </div>
  );
}
