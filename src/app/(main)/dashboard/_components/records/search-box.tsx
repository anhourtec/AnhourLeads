"use client";

import { useEffect, useState } from "react";

import { Search } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

import { useUrlParams } from "./use-url-params";

/** Keyword search kept in the `q` URL parameter, applied 300 ms after typing stops. */
export function SearchBox({ placeholder, label }: { placeholder: string; label: string }) {
  const { searchParams, setParams } = useUrlParams();
  const current = searchParams.get("q") ?? "";
  const [value, setValue] = useState(current);

  useEffect(() => setValue(current), [current]);

  useEffect(() => {
    if (value.trim() === current.trim()) return;
    const timer = setTimeout(() => setParams({ q: value.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [value, current, setParams]);

  return (
    <InputGroup className="h-7 w-full sm:w-64">
      <InputGroupAddon align="inline-start">
        <Search className="size-3.5" aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={label}
        className="h-7"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") setParams({ q: value.trim() || null });
        }}
      />
    </InputGroup>
  );
}
