/**
 * Conjunctions that stay lower-cased in the middle of a title.
 *
 * {@link handleSpecialWords} matches the lower-cased input word against this list, so entries must be lower-case.
 * Only words shorter than four characters are ever lower-cased, so the longer entries only matter if that length
 * rule changes.
 */
export default [
	'and',
	'that',
	'but',
	'or',
	'as',
	'if',
	'when',
	'than',
	'because',
	'while',
	'where',
	'after',
	'so',
	'though',
	'since',
	'until',
	'whether',
	'before',
	'although',
	'nor',
	'like',
	'once',
	'unless',
	'now',
	'except',
] as string[];
