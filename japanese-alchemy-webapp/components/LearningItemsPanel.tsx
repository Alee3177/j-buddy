'use client';

/**
 * Japanese Reader v0.4 P2.2 — read-only presentation for the "學習項目" tab.
 *
 * Pure function of props: all state lives in `useLearningItemsFeed`
 * (lib/learningItemsFeed.ts). Renders raw saved occurrences newest-first, one
 * card each — no grouping, no edit/delete, no filter/search. Only fields that
 * actually exist on `LearningItem` are shown; nothing is recomputed.
 */

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { parseFurigana, safeExternalUrl } from '@/lib/textUtils';
import { useState } from 'react';
import type { LearningItem } from '@/types';
import type { LearningItemsFeedState } from '@/lib/learningItemsFeed';

type AddToReviewStatus = 'idle' | 'pending' | 'done' | 'error';

function AddToReviewButton({
  item,
  onAddToReview,
}: {
  item: LearningItem;
  onAddToReview: (item: LearningItem) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<AddToReviewStatus>('idle');

  if (status === 'done') {
    return <span className="text-xs text-muted-foreground">已加入複習</span>;
  }

  const handleClick = async () => {
    setStatus('pending');
    try {
      await onAddToReview(item);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={status === 'pending'}
        onClick={handleClick}
      >
        加入複習
      </Button>
      {status === 'error' && (
        <span className="text-xs text-gray-500">加入失敗，請再試一次</span>
      )}
    </span>
  );
}

function LearningItemCard({
  item,
  onAddToReview,
}: {
  item: LearningItem;
  onAddToReview?: (item: LearningItem) => Promise<unknown>;
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
        {onAddToReview && (
          <div className="pt-2">
            <AddToReviewButton item={item} onAddToReview={onAddToReview} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LearningItemsPanel({
  state,
  onLoadMore,
  onAddToReview,
}: {
  state: LearningItemsFeedState;
  onLoadMore: () => void;
  onAddToReview?: (item: LearningItem) => Promise<unknown>;
}) {
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
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-gray-500">尚無學習項目</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {state.items.map((item) => (
          <LearningItemCard
            key={item.id}
            item={item}
            onAddToReview={onAddToReview}
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
