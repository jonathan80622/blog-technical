import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = { title: "VC Intelligence", description: "Evidence-first venture research" };
/**
 * UI-ID: UI-LAYOUT-001
 * Backend: none. This shell has no request, mutation, or durable-progress state.
 */
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
