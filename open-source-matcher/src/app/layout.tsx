import type { Metadata } from "next";

import { CopilotKit } from "@copilotkit/react-core";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";

const runtimeUrl = process.env.NEXT_PUBLIC_COPILOTKIT_URL ?? "http://localhost:4000/copilotkit";

export const metadata: Metadata = {
  title: "Open Source Hunter",
  description: "Discover and evaluate open-source projects with an AI hunter.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CopilotKit runtimeUrl={runtimeUrl}>
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
