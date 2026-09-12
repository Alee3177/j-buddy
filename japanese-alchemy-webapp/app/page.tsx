'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppHeader } from '@/components/AppHeader';
import { WelcomeCard } from '@/components/WelcomeCard';
import { EmptyState } from '@/components/EmptyState';
import { shouldShowWelcomeCard } from '@/lib/welcomeCard';
import {
  getUserVocabularies,
  getUserGrammars,
  getUserAnalysisPages,
  deleteAnalysisPage,
  getSharedAnalysisPages,
  getSharedVocabularies,
  getSharedGrammars,
} from '@/services/firestoreService';
import { useLearningItemsFeed } from '@/lib/learningItemsFeed';
import { LearningItemsPanel } from '@/components/LearningItemsPanel';
import { useReviewSession } from '@/lib/reviewSession';
import { useReviewCardKeys } from '@/lib/reviewCardKeys';
import { ReviewPanel } from '@/components/ReviewPanel';
import { materializeReviewCard } from '@/services/reviewService';
import { Vocabulary, Grammar, AnalysisPage, LearningItem } from '@/types';
import { 
  parseFurigana, 
  renderVocabularyDetail,
  renderGrammarExplanation,
  markdownToHtml,
} from '@/lib/textUtils';

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function SharedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      共享
    </span>
  );
}

function SharedSourceAttribution({ metadata }: { metadata?: { source_text?: string; source_url?: string } }) {
  if (!metadata?.source_text && !safeSourceUrl(metadata?.source_url ?? '')) return null;

  const sourceUrl = safeSourceUrl(metadata?.source_url ?? '');

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {metadata?.source_text && (
        <span dangerouslySetInnerHTML={{ __html: parseFurigana(metadata.source_text) }} />
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
    </div>
  );
}

export default function Dashboard() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  
  const [vocabularies, setVocabularies] = useState<Vocabulary[]>([]);
  const [grammars, setGrammars] = useState<Grammar[]>([]);
  const [analysisPages, setAnalysisPages] = useState<AnalysisPage[]>([]);
  const [sharedAnalysisPages, setSharedAnalysisPages] = useState<AnalysisPage[]>([]);
  const [sharedVocabularies, setSharedVocabularies] = useState<Vocabulary[]>([]);
  const [sharedGrammars, setSharedGrammars] = useState<Grammar[]>([]);
  const [activeTab, setActiveTab] = useState('vocabularies');

  // Japanese Reader v0.4 P2.2 — read-only personal learning-items feed.
  // Driven by the auth lifecycle: no query before auth resolves, cleared on
  // sign-out, and reloaded fresh when the signed-in user changes.
  const { state: learningFeed, loadMore: loadMoreLearningItems } =
    useLearningItemsFeed(user?.uid ?? null, !loading);

  // Japanese Reader v0.4 P3.4 — due-review session for the "複習" tab.
  const reviewSession = useReviewSession(user?.uid ?? null, !loading);

  // Japanese Reader v0.4 P4.4 — persistent "已加入複習" state for the 學習項目 tab.
  const reviewCardKeys = useReviewCardKeys(user?.uid ?? null, !loading);

  const { addKey: addReviewedKey } = reviewCardKeys;
  const handleAddToReview = useCallback(
    async (item: LearningItem) => {
      const card = await materializeReviewCard(item);
      // Optimistically flip every occurrence of this lexicalKey to 已加入複習.
      addReviewedKey(item.lexicalKey);
      return card;
    },
    [addReviewedKey]
  );

  useEffect(() => {
    let loadingData = true;
    const loadData = async () => {
      try {
        if (user) {
          const [
            vocabData, grammarData, pagesData,
            sharedPagesData, sharedVocabData, sharedGrammarData,
          ] = await Promise.all([
            getUserVocabularies(user.uid),
            getUserGrammars(user.uid),
            getUserAnalysisPages(user.uid),
            getSharedAnalysisPages(),
            getSharedVocabularies(),
            getSharedGrammars(),
          ]);
          if (!loadingData) return;
          setVocabularies(vocabData);
          setGrammars(grammarData);
          setAnalysisPages(pagesData);
          setSharedAnalysisPages(sharedPagesData);
          setSharedVocabularies(sharedVocabData);
          setSharedGrammars(sharedGrammarData);
        } else {
          const [sharedPagesData, sharedVocabData, sharedGrammarData] = await Promise.all([
            getSharedAnalysisPages(),
            getSharedVocabularies(),
            getSharedGrammars(),
          ]);
          if (!loadingData) return;
          setSharedAnalysisPages(sharedPagesData);
          setSharedVocabularies(sharedVocabData);
          setSharedGrammars(sharedGrammarData);
        }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };

    if (!loading) {
      void loadData();
    }
    return () => {
      loadingData = false;
    };
  }, [user, loading]);

  const handleSignIn = () => {
    router.push('/auth');
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth');
  };

  const handleDeleteAnalysisPage = async (pageId: string) => {
    if (!user) return;
    await deleteAnalysisPage(user.uid, pageId);
    setAnalysisPages((pages) => pages.filter((page) => page.id !== pageId));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">載入中...</div>
      </div>
    );
  }

  const allVocabularies = user ? [...vocabularies, ...sharedVocabularies] : sharedVocabularies;
  const allGrammars = user ? [...grammars, ...sharedGrammars] : sharedGrammars;

  const showWelcomeCard = shouldShowWelcomeCard({
    signedIn: user != null,
    vocabularyCount: vocabularies.length,
    grammarCount: grammars.length,
    pageCount: analysisPages.length,
    learningItemCount: learningFeed.items.length,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
      <AppHeader user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {showWelcomeCard && (
          <div className="mb-6">
            <WelcomeCard />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList
            className={`grid w-full ${user ? 'max-w-4xl grid-cols-6' : 'max-w-xl grid-cols-3'}`}
          >
            <TabsTrigger value="vocabularies">
              單字 ({allVocabularies.length})
            </TabsTrigger>
            <TabsTrigger value="grammars">
              文法 ({allGrammars.length})
            </TabsTrigger>
            {user && (
              <TabsTrigger value="pages">
                頁面 ({analysisPages.length})
              </TabsTrigger>
            )}
            {user && (
              <TabsTrigger value="learning">
                學習項目 ({learningFeed.items.length})
              </TabsTrigger>
            )}
            {user && (
              <TabsTrigger value="review">
                複習 ({reviewSession.remaining})
              </TabsTrigger>
            )}
            <TabsTrigger value="shared-pages">
              共享頁面 ({sharedAnalysisPages.length})
            </TabsTrigger>
          </TabsList>

          {/* Vocabularies Tab */}
          <TabsContent value="vocabularies" className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold">{user ? '我的單字' : '共享單字'}</h2>
              <p className="text-muted-foreground">
                {user ? '查看你的日語單字收藏' : '瀏覽社群共享的日語單字'}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {allVocabularies.length === 0 ? (
                <EmptyState title="找不到單字。" className="col-span-full" />
              ) : (
                allVocabularies.map((vocab) => (
                  <Card key={vocab.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        {vocab.isShared && <SharedBadge />}
                        <CardTitle 
                          className="text-xl"
                          dangerouslySetInnerHTML={{ __html: parseFurigana(vocab.term) }}
                        />
                      </div>
                      <CardDescription>
                        {new Date(vocab.createdAt).toLocaleDateString("zh-TW")}
                      </CardDescription>
                      {vocab.isShared && <SharedSourceAttribution metadata={vocab.metadata} />}
                    </CardHeader>
                    <CardContent className="flex-grow">
                      <div 
                        className="text-sm markdown-content"
                        dangerouslySetInnerHTML={{ __html: renderVocabularyDetail(vocab.detail) }}
                      />
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Grammars Tab */}
          <TabsContent value="grammars" className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold">{user ? '我的文法' : '共享文法'}</h2>
              <p className="text-muted-foreground">
                {user ? '查看你的日語文法重點' : '瀏覽社群共享的日語文法重點'}
              </p>
            </div>

            <div className="grid gap-4">
              {allGrammars.length === 0 ? (
                <EmptyState title="找不到文法重點。" />
              ) : (
                allGrammars.map((grammar) => (
                  <Card key={grammar.id}>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        {grammar.isShared && <SharedBadge />}
                        <CardTitle 
                          className="text-xl"
                          dangerouslySetInnerHTML={{ __html: parseFurigana(grammar.point) }}
                        />
                      </div>
                      <CardDescription>
                        {new Date(grammar.createdAt).toLocaleDateString("zh-TW")}
                      </CardDescription>
                      {grammar.isShared && <SharedSourceAttribution metadata={grammar.metadata} />}
                    </CardHeader>
                    <CardContent>
                      <div 
                        className="text-sm markdown-content"
                        dangerouslySetInnerHTML={{ __html: renderGrammarExplanation(grammar.explanation) }}
                      />
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Pages Tab (authenticated only) */}
          {user && (
            <TabsContent value="pages" className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold">我的頁面</h2>
                <p className="text-muted-foreground">
                  瀏覽你儲存的分析頁面
                </p>
              </div>

              <div className="grid gap-4">
                {analysisPages.length === 0 ? (
                  <EmptyState title="找不到分析頁面。" />
                ) : (
                  analysisPages.map((page) => {
                    const sourceUrl = safeSourceUrl(page.source_url);

                    return (
                      <Card key={page.id}>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-4">
                            <CardTitle
                              className="text-xl"
                              dangerouslySetInnerHTML={{ __html: parseFurigana(page.source_text) }}
                            />
                            <Button variant="destructive" size="sm" onClick={() => handleDeleteAnalysisPage(page.id)}>
                              刪除
                            </Button>
                          </div>
                          <CardDescription>
                            {new Date(page.createdAt).toLocaleDateString("zh-TW")}
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
                        <CardContent>
                          <div
                            className="text-sm markdown-content"
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(parseFurigana(page.rendered_markdown)) }}
                          />
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </TabsContent>
          )}

          {user && (
            <TabsContent value="learning" className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold">我的學習項目</h2>
                <p className="text-muted-foreground">
                  依儲存時間排列的單字與文法紀錄
                </p>
              </div>

              <LearningItemsPanel
                state={learningFeed}
                onLoadMore={loadMoreLearningItems}
                onAddToReview={handleAddToReview}
                reviewedKeys={reviewCardKeys.keys}
                reviewKeysLoading={reviewCardKeys.loading}
                reviewKeysError={reviewCardKeys.error}
              />
            </TabsContent>
          )}

          {user && (
            <TabsContent value="review" className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold">複習</h2>
                <p className="text-muted-foreground">
                  複習今天到期的單字與文法
                </p>
              </div>

              <ReviewPanel session={reviewSession} />
            </TabsContent>
          )}

          <TabsContent value="shared-pages" className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold">共享頁面</h2>
              <p className="text-muted-foreground">
                瀏覽其他學習者共享的分析頁面
              </p>
            </div>

            <div className="grid gap-4">
              {sharedAnalysisPages.length === 0 ? (
                <EmptyState title="找不到共享分析頁面。" />
              ) : (
                sharedAnalysisPages.map((page) => {
                  const sourceUrl = safeSourceUrl(page.source_url);

                  return (
                    <Card key={page.id}>
                      <CardHeader>
                        <CardTitle
                          className="text-xl"
                          dangerouslySetInnerHTML={{ __html: parseFurigana(page.source_text) }}
                        />
                        <CardDescription>
                          {new Date(page.createdAt).toLocaleDateString("zh-TW")}
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
                      <CardContent>
                        <div
                          className="text-sm markdown-content"
                          dangerouslySetInnerHTML={{ __html: markdownToHtml(parseFurigana(page.rendered_markdown)) }}
                        />
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
