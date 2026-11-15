import Link from "next/link";

// Unknown address, or something the visitor isn't allowed to see (pages answer "not found"
// rather than revealing that it exists).
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6 min-h-[60vh]">
      <div className="card max-w-md w-full p-7 text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-muted mt-2 leading-relaxed">That page doesn&apos;t exist, or it isn&apos;t shared with your account.</p>
        <Link href="/dashboard" className="btn btn-primary mt-6 !px-5">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
