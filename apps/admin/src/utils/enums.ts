export enum GamePointLookup {
	GUESS = 'guess',
	ALLCORRECT = 'allcorrect',
	DOUBLEDOWN = 'doubledown',
	GAMBLING_WIN = 'gambling_win',
	GAMBLING_LOSE = 'gambling_lose',
	BBFL_AUDIO = 'bbfl_audio',
	BBFL_VIDEO = 'bbfl_video',
	BBFL_POST = 'bbfl_post',
	TAG_VOTE = 'tag-vote',
}
export enum GameTypeLookup {
	WTFIR = 'wtfir',
}
export const domainDataGameTypes = [
	{
		lookupID: GameTypeLookup.WTFIR,
		title: 'WTFIR',
		description: 'The main game where users try to guess the host\'s rating of the assigned movies for the week',
	}
]
export const domainDataGamePoints = [
	{
		lookupID: GamePointLookup.GUESS,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'Rating Guess',
		description: 'Correctly guessed the host\'s rating of the assignment movie',
	},
	{
		lookupID: GamePointLookup.ALLCORRECT,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'All Correct',
		description: 'Correctly guessed all of the hosts\' ratings of the assignment movie',
	},
	{
		lookupID: GamePointLookup.DOUBLEDOWN,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 2,
		title: 'Double Down',
		description: 'Correctly guessed the host\'s rating of the assignment movie',
	},
	{
		lookupID: GamePointLookup.GAMBLING_WIN,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'Gambled and Won',
		description: 'Successfully bet that all of their guesses would be correct',
	},
	{
		lookupID: GamePointLookup.GAMBLING_LOSE,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'Gambled and Lost',
		description: 'Unsuccessfully bet that all of their guesses would be correct',
	},
	{
		lookupID: GamePointLookup.BBFL_AUDIO,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'BBFL Audio',
		description: 'Submitted an audio recording of someone saying Bad Boys For Life',
	},
	{
		lookupID: GamePointLookup.BBFL_VIDEO,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'BBFL Video',
		description: 'Submitted a video of someone saying Bad Boys For Life',
	},
	{
		lookupID: GamePointLookup.BBFL_POST,
		gameTypeLookupID: GameTypeLookup.WTFIR,
		points: 1,
		title: 'BBFL Post',
		description: 'Posted a video of someone saying Bad Boys For Life to their social media',
	},
]