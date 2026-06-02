export default function Header() {
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">
          Simford
        </span>
        <nav className="flex gap-6 text-sm text-neutral-600">
          <a href="/" className="hover:text-neutral-900">
            Home
          </a>
          <a href="/relationships" className="hover:text-neutral-900">
            Relationships
          </a>
        </nav>
      </div>
    </header>
  );
}
