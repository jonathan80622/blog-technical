import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = { title: "VC Intelligence", description: "Evidence-first venture research" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
