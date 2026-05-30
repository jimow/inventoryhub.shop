import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Inventory Management System",
  description: "Inventory, sales, purchases, customers, suppliers — built on Next.js + Supabase.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
