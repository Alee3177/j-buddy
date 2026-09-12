import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

export const metadata: Metadata = {
  title: "J-Buddy Learn Japanese - 單字與文法學習",
  description: "一個使用 Next.js、shadcn/ui 和 Firebase 構建的日語單字與文法學習應用程式",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className="antialiased" style={{ fontFamily: '"LINE Seed JP", sans-serif' }}>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
