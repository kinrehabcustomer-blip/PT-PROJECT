import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/presentation/state/app-context";
import { AppShell } from "@/presentation/components/navigation/app-shell";

export const metadata: Metadata = {
  title: "PT Care | จัดการนัดหมายและคอร์ส",
  description: "ระบบจัดการนัดหมาย การแจ้งเตือน และคอร์สการรักษากายภาพบำบัด",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
