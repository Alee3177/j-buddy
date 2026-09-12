import Link from 'next/link';
import type { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function AppHeader({
  user,
  onSignIn,
  onSignOut,
}: {
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="bg-card border-b shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-primary">J-Buddy Learn Japanese</h1>
        <div className="flex items-center gap-4">
          <Link
            href="/how-to-use"
            prefetch={false}
            className="text-sm text-primary hover:underline"
          >
            如何使用
          </Link>
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">{user.email}</span>
              <ThemeToggle />
              <Button onClick={onSignOut} variant="outline" size="sm">
                登出
              </Button>
            </>
          ) : (
            <>
              <ThemeToggle />
              <Button onClick={onSignIn} variant="default" size="sm">
                登入
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
