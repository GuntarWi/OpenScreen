import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FALLBACK_EMOJIS, loadTelegramEmojis, type TelegramEmoji } from "@/lib/telegramEmojis";

interface EmojiPickerPanelProps {
  selectedSrc?: string | null;
  onSelect: (emoji: TelegramEmoji) => void;
  searchPlaceholder?: string;
  className?: string;
}

export function EmojiPickerPanel({
  selectedSrc,
  onSelect,
  searchPlaceholder = "Search Telegram emoji...",
  className,
}: EmojiPickerPanelProps) {
  const [emojiSearch, setEmojiSearch] = useState("");
  const [emojiResults, setEmojiResults] = useState<TelegramEmoji[]>(FALLBACK_EMOJIS);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [emojiError, setEmojiError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setEmojiLoading(true);
    loadTelegramEmojis()
      .then((results) => {
        if (!active) return;
        setEmojiResults(results);
        setEmojiError(null);
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load emoji manifest", err);
        setEmojiError("Unable to load emoji list. Showing cached defaults.");
      })
      .finally(() => {
        if (active) setEmojiLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredEmojis = useMemo(() => {
    const query = emojiSearch.toLowerCase().trim();
    if (!query) return emojiResults;
    return emojiResults.filter((emoji) =>
      emoji.name.toLowerCase().includes(query) ||
      emoji.category.toLowerCase().includes(query),
    );
  }, [emojiResults, emojiSearch]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={emojiSearch}
          onChange={(e) => setEmojiSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#34B27B] focus:border-transparent"
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-400 hover:text-slate-100 hover:bg-white/5"
          onClick={() => setEmojiSearch("")}
        >
          Clear
        </Button>
      </div>

      {emojiError ? (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          {emojiError}
        </div>
      ) : null}

      <div className="max-h-56 overflow-y-auto rounded-xl border border-white/5 bg-white/5 p-2">
        {emojiLoading ? (
          <div className="text-sm text-slate-400 text-center py-6">Loading emoji…</div>
        ) : filteredEmojis.length > 0 ? (
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
            {filteredEmojis.map((emoji) => {
              const isActive = selectedSrc === emoji.src;
              return (
                <button
                  key={`${emoji.category}-${emoji.name}`}
                  onClick={() => onSelect(emoji)}
                  className={cn(
                    "group flex flex-col items-center gap-1 p-2 rounded-lg border text-[11px] text-slate-300 hover:bg-white/10 hover:border-white/20 transition",
                    isActive && "border-[#34B27B] bg-[#34B27B]/10 text-white",
                  )}
                >
                  <div className="w-10 h-10 rounded-md bg-black/30 flex items-center justify-center overflow-hidden border border-white/5">
                    <img src={emoji.src} alt={emoji.name} className="w-full h-full object-contain" loading="lazy" />
                  </div>
                  <span className="w-full text-center truncate">{emoji.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-slate-400 text-center py-4">No emoji found</div>
        )}
      </div>
    </div>
  );
}
