/**
 * src/components/common/Select.tsx
 *
 * A plain native <select>, styled.
 *
 * WHY NOT RADIX HERE: Radix Select exists in the dependencies and will be used
 * where a custom-rendered option list is genuinely needed. For a short list of
 * plain text options a native select is smaller, keyboard-accessible for free,
 * and on mobile it opens the OS picker, which is better than anything we would
 * build. Reach for the heavier component only when the lighter one fails.
 */

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  'aria-label'?: string;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = 'All',
  ...rest
}: Props) {
  return (
    <div className="relative">
      <select
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-xl bg-zinc-50 pl-space-md pr-8 font-body-sm text-body-sm text-zinc-900 outline-none ring-indigo-200 focus:ring-2"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="icon pointer-events-none absolute right-space-sm top-1/2 -translate-y-1/2 text-[16px] text-zinc-400">
        expand_more
      </span>
    </div>
  );
}
