import { type Dispatch, type FC, type SetStateAction, useEffect, useRef, useState } from "react";
import { HiSearch, HiX } from "react-icons/hi";

interface SearchProps {
	setSearch: Dispatch<SetStateAction<string>>;
}

const Search: FC<SearchProps> = ({ setSearch }) => {
	const initial = useRef(true);
	const [searchQuery, setSearchQuery] = useState("");

	useEffect(() => {
		if (initial.current) {
			initial.current = false;
			return;
		}
		const searchDebounce = setTimeout(() => {
			setSearch(searchQuery);
		}, 500);

		return () => clearTimeout(searchDebounce);
	}, [setSearch, searchQuery]);

	const clearSearch = () => {
		setSearchQuery("");
	}
	const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSearchQuery(e.target.value);
	}
	const handleSearchClick = () => {
		setSearch(searchQuery);
	}
	return (
		<div className="relative flex items-center justify-center text-white">
			<input
				type="text"
				value={searchQuery}
				placeholder="Search..."
				className="bg-black w-full rounded-md border-gray-300 shadow-sm focus:border-violet-300 focus:ring focus:ring-inset"
				onChange={handleSearchChange}
			/>
			<span>
				<HiSearch onClick={handleSearchClick} />
			</span>
			{searchQuery && (
				<button
					onClick={clearSearch}
					title="Clear search"
					className="absolute right-4 focus:outline-none flex items-center"
				>
					<HiX />
				</button>
			)}
		</div>
	);
};

export default Search;