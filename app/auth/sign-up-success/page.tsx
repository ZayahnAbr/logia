import Link from "next/link";

export default function SignUpSuccess() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="card-surface max-w-md p-10 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-blush text-2xl">✓</div>
        <h1 className="text-xl font-bold">Check your email</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a confirmation link to your address. Click it to activate your account.
        </p>
        <Link href="/auth/login" className="transition-quiet mt-6 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}