function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const SIZES = {
  sm: "h-10 w-10 text-sm",
  md: "h-12 w-12 text-base",
  lg: "h-16 w-16 text-xl",
} as const;

/**
 * Portrait placeholder. A soft neutral disc with the NPC's initials and a
 * subtle cardinal ring — stands in until real artwork exists.
 */
export default function NpcAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-neutral-100 font-semibold text-neutral-700 ring-1 ring-cardinal/20 ${SIZES[size]}`}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
