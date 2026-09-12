import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice } from '@/components/StatusNotice';

interface Step {
  title: string;
  body: string;
  notice?: { title: string; body: string };
  list?: string[];
}

const steps: Step[] = [
  {
    title: 'Step 1｜登入',
    body: '使用 Google 帳號登入 J-Buddy。',
  },
  {
    title: 'Step 2｜取得日文學習內容',
    body: '未來可使用 J-Buddy Chrome Extension，在日文網站選取文字並進行 AI 分析。',
    notice: {
      title: '目前功能狀態',
      body: 'Chrome Extension 與自動儲存功能正在升級整合中，目前暫時無法建立新的學習內容。',
    },
  },
  {
    title: 'Step 3｜整理學習項目',
    body: '儲存後的單字與文法會出現在「學習項目」。',
  },
  {
    title: 'Step 4｜開始複習',
    body: '在「學習項目」按「加入複習」，之後到「複習」頁依熟悉程度選擇：',
    list: ['重來', '良好', '簡單'],
  },
];

export default function HowToUsePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-muted px-4 py-12">
      <section className="mx-auto max-w-3xl space-y-6">
        <Link
          href="/"
          className="inline-block text-sm text-primary hover:underline"
        >
          ← 回到 J-Buddy
        </Link>

        <header className="mb-4 text-center">
          <h1 className="text-3xl font-bold text-primary">如何使用 J-Buddy</h1>
          <p className="mt-3 text-muted-foreground">
            從看到日文，到建立自己的學習內容與複習，只需要以下 4 個步驟。
          </p>
        </header>

        {steps.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="text-xl">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-7">
              <p>{step.body}</p>
              {step.list && (
                <ul className="list-disc list-inside text-muted-foreground">
                  {step.list.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              )}
              {step.notice && (
                <StatusNotice title={step.notice.title}>
                  {step.notice.body}
                </StatusNotice>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
