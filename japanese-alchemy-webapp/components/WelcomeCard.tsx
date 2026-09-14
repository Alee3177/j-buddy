import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function WelcomeCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">歡迎使用 J-Buddy</CardTitle>
        <CardDescription>
          J-Buddy 幫你把平常看到的日文，整理成自己的學習內容並安排複習。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium text-foreground">使用方式</p>
          <ol className="mt-2 list-decimal list-inside space-y-1 text-muted-foreground">
            <li>在網頁看到想學的日文</li>
            <li>使用 J-Buddy Chrome Extension 選取網頁中的日文內容，進行 AI 分析並儲存到學習項目。</li>
            <li>回到 J-Buddy 查看「學習項目」</li>
            <li>將內容加入「複習」</li>
          </ol>
        </div>
        <Button asChild variant="default" size="sm">
          <Link href="/how-to-use" prefetch={false}>
            查看如何使用
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
