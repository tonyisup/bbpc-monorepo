import React from 'react';
import { cn } from '@/lib/utils';

interface VoiceVisualizerProps {
	volume: number; // 0-100
	isRecording: boolean;
	className?: string;
}

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ volume, isRecording, className }) => {
	// 3 columns as per the reference image
	// Reduced segments and sizing to prevent overflow
	const columns = [
		{ scale: 0.7, segments: 8 },
		{ scale: 1.0, segments: 12 }, // Center is tallest
		{ scale: 0.7, segments: 8 },
	];

	if (!isRecording) return null;

	return (
		<div className={cn("flex items-center justify-center gap-2 p-2 bg-black/40 rounded-lg h-24", className)}>
			{columns.map((col, i) => {
				const totalSegments = col.segments;
				const litSegments = Math.round((volume / 100) * totalSegments);
				const emptySegments = totalSegments - litSegments;
				const paddingBottom = Math.floor(emptySegments / 2);

				return (
					<div key={i} className="flex flex-col-reverse gap-0.5">
						{Array.from({ length: totalSegments }).map((_, j) => {
							const isLit = j >= paddingBottom && j < paddingBottom + litSegments;
							return (
								<div
									key={j}
									className={cn(
										"w-5 h-1 rounded-[1px] transition-all duration-75",
										isLit
											? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]"
											: "bg-red-950/20"
									)}
								/>
							);
						})}
					</div>
				);
			})}
		</div>
	);
};
