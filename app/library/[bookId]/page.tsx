import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLibraryBook } from "@/lib/queries";
import { BookReader } from "./BookReader";
import { EpubReader } from "./EpubReader";
import { AppShell } from "@/components/AppShell";

export default async function BookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const data = await getLibraryBook(bookId);
  if (!data) notFound();

  return (
    <AppShell>
    {/\.epub$/i.test(data.book.file_path ?? "") ? (
      <EpubReader
        bookId={bookId}
        title={data.book.title}
        initialCfi={data.book.last_cfi ?? null}
        initialHighlights={data.highlights as never}
        initialBookmarks={data.bookmarks}
      />
    ) : (
    <BookReader
      bookId={bookId}
      title={data.book.title}
      initialPage={data.book.last_page}
      initialHighlights={data.highlights as never}
      initialBookmarks={data.bookmarks}
    />
    )}
    </AppShell>
  );
}
