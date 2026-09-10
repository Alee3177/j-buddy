'use client';

/**
 * Japanese Reader v0.4 P3.4 — presentation for the "複習" review tab.
 *
 * Pure function of a `ReviewSession` (lib/reviewSession.ts). Shows one card at a
 * time: front = type badge + surface only; after "顯示答案" the reading / meaning
 * / source sentence / safe source link are revealed and the rating buttons
 * enable. A successful rating advances automatically — there is no "Next"
 * button.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { parseFurigana, safeExternalUrl } from '@/lib/textUtils';
import { RATING } from '@/lib/reviewCard';
import type { ReviewSession } from '@/lib/reviewSession';

export function ReviewPanel({ session }: { session: ReviewSession }) {
  const { state, currentCard, remaining, reveal, rate } = session;

  if (state.phase === 'loading') {
    return <p className="py-8 text-center text-muted-foreground">載入中...</p>;
  }

  if (state.phase === 'error') {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-gray-500">無法載入複習項目</p>
        </CardContent>
      </Card>
    );
  }

  if (!currentCard) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-gray-500">今天沒有要複習的項目</p>
        </CardContent>
      </Card>
    );
  }

  const sourceUrl = safeExternalUrl(currentCard.sourceUrl);
  const ratingDisabled = !state.revealed || state.rating;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">剩餘 {remaining}</p>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {currentCard.type === 'vocab' ? '單字' : '文法'}
            </Badge>
            <CardTitle
              className="text-2xl"
              dangerouslySetInnerHTML={{
                __html: parseFurigana(currentCard.surface),
              }}
            />
          </div>
        </CardHeader>

        {state.revealed && (
          <CardContent className="space-y-1 text-sm">
            {currentCard.reading && (
              <p className="text-muted-foreground">{currentCard.reading}</p>
            )}
            {currentCard.meaning && (
              <p
                dangerouslySetInnerHTML={{
                  __html: parseFurigana(currentCard.meaning),
                }}
              />
            )}
            {currentCard.sourceSentence && (
              <p
                className="text-muted-foreground"
                dangerouslySetInnerHTML={{
                  __html: parseFurigana(currentCard.sourceSentence),
                }}
              />
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                來源
              </a>
            )}
          </CardContent>
        )}
      </Card>

      <div className="flex flex-col items-center gap-3">
        {!state.revealed && (
          <Button variant="outline" onClick={reveal}>
            顯示答案
          </Button>
        )}

        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            disabled={ratingDisabled}
            onClick={() => rate(RATING.AGAIN)}
          >
            重來
          </Button>
          <Button
            variant="outline"
            disabled={ratingDisabled}
            onClick={() => rate(RATING.GOOD)}
          >
            良好
          </Button>
          <Button
            variant="outline"
            disabled={ratingDisabled}
            onClick={() => rate(RATING.EASY)}
          >
            簡單
          </Button>
        </div>
      </div>

      {state.mutationError && (
        <p className="text-center text-sm text-gray-500">
          更新複習狀態時發生錯誤
        </p>
      )}
    </div>
  );
}
