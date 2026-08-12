import React, { useState, useEffect } from "react";
import { HiSearch } from "react-icons/hi";

const SearchFilter = ({
  onSearch,
  initialValue = "",
}: {
  onSearch: (query: string) => void;
  initialValue?: string;
}) => {
  const [searchQuery, setSearchQuery] = useState(initialValue);

  useEffect(() => {
    setSearchQuery(initialValue);
  }, [initialValue]);

  const handleSearch = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  return (
    <div>
      <form onSubmit={handleSearch} className="flex items-stretch">
        <input
          type="text"
          placeholder="Search episodes..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            onSearch(e.target.value);
          }}
          aria-label="Search episodes"
          className="min-w-0 flex-grow rounded-l-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center gap-2 rounded-r-lg border border-red-500 bg-red-500 px-4 font-semibold text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
        >
          <HiSearch className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">Search</span>
        </button>
      </form>
    </div>
  );
};

export default SearchFilter;
