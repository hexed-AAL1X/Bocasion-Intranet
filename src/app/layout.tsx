import type { Metadata } from "next";
import "./globals.css";
import { geistSans, geistMono } from "@/fonts";
import LenisProvider from "./lenis-provider";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import AuthGate from "@/components/AuthGate";
import { AreaAccessGate } from "@/components/AreaAccessGate";
import { TicketLookupProvider } from "@/components/TicketLookupProvider";
import { UiPrefsProvider } from "@/contexts/UiPrefsContext";
import { CalendarEventsProvider } from "@/contexts/CalendarEventsContext";
import { TicketsProvider } from "@/contexts/TicketsContext";
import { NotionToggleProvider } from "@/contexts/NotionToggleContext";
import { MessagesToggleProvider } from "@/contexts/MessagesToggleContext";
import { CalendarToggleProvider } from "@/contexts/CalendarToggleContext";

export const metadata: Metadata = {
  title: "Bocasión - Intranet",
  description: "Panel interno de tickets y analíticas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`} data-lenis-scrollbar>
        <LenisProvider>
          <AppErrorBoundary>
            <AuthGate>
              <AreaAccessGate>
              <UiPrefsProvider>
                <CalendarEventsProvider>
                  <TicketsProvider>
                    <NotionToggleProvider>
                      <MessagesToggleProvider>
                        <CalendarToggleProvider>
                          <TicketLookupProvider>{children}</TicketLookupProvider>
                        </CalendarToggleProvider>
                      </MessagesToggleProvider>
                    </NotionToggleProvider>
                  </TicketsProvider>
                </CalendarEventsProvider>
              </UiPrefsProvider>
              </AreaAccessGate>
            </AuthGate>
          </AppErrorBoundary>
        </LenisProvider>
      </body>
    </html>
  );
}
