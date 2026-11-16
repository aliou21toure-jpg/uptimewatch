import { PublicStatusView } from "@/components/status-pages/public-view";
import { getDb } from "@uptimewatch/db";
import { getPublicStatusPage } from "@uptimewatch/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

/**
 * Public, unauthenticated. Rendered on demand and cached for 30 seconds (ISR); edits made in the
 * app revalidate the path immediately. Reads cookies/headers nowhere, so it stays cacheable.
 */
export const revalidate = 30;
export const dynamicParams = true;
export const generateStaticParams = async () => [];

const load = cache((slug: string) => getPublicStatusPage(getDb(), slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await load((await params).slug);
  return page
    ? { title: page.title, description: page.description ?? `Current status of ${page.title}` }
    : { title: "Status page not found" };
}

export default async function PublicStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await load((await params).slug);
  if (!page) notFound();
  return <PublicStatusView page={page} />;
}
