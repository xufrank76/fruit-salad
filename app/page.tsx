import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Nothing here yet &mdash; sync is being de-risked first.
      </p>
      <Link
        href="/sync-test"
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        Go to sync prototype
      </Link>
    </div>
  );
}
