import React, { useEffect, useRef } from "react";

interface AudioStreamProps {
	stream: MediaStream;
	id?: string;
}

const AudioStream: React.FC<AudioStreamProps> = ({ stream, id }) => {
	const audioRef = useRef<HTMLAudioElement>(null);

	useEffect(() => {
		if (audioRef.current && stream) {
			audioRef.current.srcObject = stream;
		}
		return () => {
			if (audioRef.current) {
				audioRef.current.srcObject = null;
			}
		};
	}, [stream]);

	return <audio ref={audioRef} id={id} autoPlay playsInline controls={false} style={{ display: "none" }} aria-hidden="true" />;
};

export default AudioStream;
