import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/presentation/state/app-context";
import { AppShell } from "@/presentation/components/navigation/app-shell";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-dm", display: "swap" });
const plexThai = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-thai", display: "swap" });

export const metadata: Metadata = {
  title: "PT Care | จัดการนัดหมายและคอร์ส",
  description: "ระบบจัดการนัดหมาย การแจ้งเตือน และคอร์สการรักษากายภาพบำบัด",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${dmSans.variable} ${plexThai.variable}`}>
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
