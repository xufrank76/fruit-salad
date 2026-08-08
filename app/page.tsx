import Link from "next/link";

const MODES = [
  {
    label: "private",
    caption: "sing with friends",
    href: "/song",
  },
  {
    label: "public",
    caption: "complete a song with strangers",
    href: "#",
  },
  {
    label: "gallery",
    caption: "get serenaded by strangers idk",
    href: "#",
  },
];

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 font-sans dark:bg-black">
      <div className="flex gap-6">
        {MODES.map((mode) => {
          const enabled = mode.href !== "#";
          return (
            <Link
              key={mode.label}
              href={mode.href}
              aria-disabled={!enabled}
              className={`flex w-36 flex-col items-center gap-2 rounded-lg border border-zinc-200 px-4 py-6 text-center dark:border-zinc-800 ${
                enabled
                  ? "hover:border-zinc-400 dark:hover:border-zinc-600"
                  : "pointer-events-none opacity-40"
              }`}
            >
              <span className="text-sm font-medium text-black dark:text-zinc-50">
                {mode.label}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {mode.caption}
              </span>
            </Link>
          );
        })}
      </div>

      <Link
        href="/sync-test"
        className="absolute bottom-6 left-6 text-xs text-zinc-400 underline dark:text-zinc-600"
      >
        sync prototype
      </Link>
      <span className="absolute bottom-6 right-6 text-lg font-semibold text-black dark:text-zinc-50">
        fruit salad
      </span>
    </div>
  );
}
