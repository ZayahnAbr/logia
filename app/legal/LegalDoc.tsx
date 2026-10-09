import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SiteNav, SiteFooter } from "@/components/site/SiteChrome";
import { CONTACT_EMAIL, EFFECTIVE_DATE } from "@/lib/legal";
import "./legal.css";

export const LEGAL_DOCS = [
  { slug: "terms", label: "Terms of Use" },
  { slug: "acceptable-use", label: "Acceptable Use Policy" },
  { slug: "privacy", label: "Privacy Policy" },
  { slug: "takedown", label: "Reporting and takedown" },
] as const;

export function legalMetadata(slug: string) {
  const d = LEGAL_DOCS.find((x) => x.slug === slug);
  return { title: `${d?.label ?? "Legal"} · Logia`, description: `${d?.label ?? "Legal"} for Logia.`, robots: { index: true, follow: true } };
}

export function LegalDoc({ slug }: { slug: string }) {
  const file = path.join(process.cwd(), "docs", "legal", `${slug}.md`);
  const text = fs.readFileSync(file, "utf8").replaceAll("{{EMAIL}}", CONTACT_EMAIL).replaceAll("{{EFFECTIVE}}", EFFECTIVE_DATE);
  return (
    <div className="landing site" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <SiteNav />
      <main id="main" className="l-wrap legal-wrap">
        <nav aria-label="Legal documents" className="legal-nav">
          {LEGAL_DOCS.map((d) => (
            <Link key={d.slug} href={`/legal/${d.slug}`} aria-current={d.slug === slug ? "page" : undefined}>{d.label}</Link>
          ))}
        </nav>
        <article className="legal-doc">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (href?.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href}>{children}</a>),
            }}
          >
            {text}
          </ReactMarkdown>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
