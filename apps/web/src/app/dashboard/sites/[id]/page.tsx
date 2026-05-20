import { redirect } from "next/navigation";

/** Legacy / mistaken links after template deploy → open Editor with site selected. */
export default async function SiteIdRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/editor?siteId=${encodeURIComponent(id)}`);
}
