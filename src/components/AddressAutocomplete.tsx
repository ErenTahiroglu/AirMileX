import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchAddresses, type AddressSuggestion } from "@/services/addressSearch";

interface AddressAutocompleteProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  onChange: (value: string) => void;
}

/** Address input with debounced, server-proxied search suggestions. */
const AddressAutocomplete = ({
  id,
  label,
  value,
  placeholder,
  required,
  onChange,
}: AddressAutocompleteProps) => {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const justSelected = useRef(false);
  const debouncedValue = useDebouncedValue(value, 300);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }

    let active = true;
    if (debouncedValue.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    searchAddresses(debouncedValue).then((results) => {
      if (!active) return;
      setSuggestions(results);
      setOpen(results.length > 0);
    });

    return () => {
      active = false;
    };
  }, [debouncedValue]);

  const select = (suggestion: AddressSuggestion) => {
    justSelected.current = true;
    onChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className="relative space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        required={required}
        maxLength={300}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.label}-${suggestion.lat}-${suggestion.lon}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full rounded-sm px-2 py-2 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(suggestion)}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AddressAutocomplete;
