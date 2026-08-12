import { type FC } from "react";
import { FaDollarSign, FaPoo, FaTrashAlt } from "react-icons/fa";
import { BiCameraMovie } from "react-icons/bi";

interface RatingProps {
	value: number | undefined,
}

const RatingIcon: FC<RatingProps> = ({value}) => {
  const renderRating = () => {
		if (!value) return null;
    switch(value) {
      case 1: return <span className="text-red-500" title="Goldbloom - Worst"><FaPoo /></span>
      case 2: return <span className="text-orange-500" title="Waste - Bad"><FaTrashAlt /></span>
      case 3: return <span className="text-yellow-500" title="Dollar - Good"><FaDollarSign /></span>
      case 4: return <span className="text-green-500" title="Slater - Best"><BiCameraMovie /></span>
			default: return null;
    }
  }
  return (
		<>
    	{renderRating()}
		</>
  )
}

export default RatingIcon