import { expect, test } from 'vitest';
import { formatTitle } from './index.js';

/**
 * End-to-end cases covering camelCase, PascalCase, snake_case, kebab-case, a minor word and a special-case brand.
 */
const tests: [string, string][] = [
	['snowWhiteAndTheSevenDwarfs', 'Snow White and the Seven Dwarfs'],
	['NewcastleUponTyne', 'Newcastle Upon Tyne'],
	['brighton_on_sea', 'Brighton on Sea'],
	['apple_releases_new_ipad', 'Apple Releases New iPad'],
	['7-food-trends', '7 Food Trends'],
];

for (const [input, output] of tests) {
	test(`${input} => ${output}`, () => {
		expect(formatTitle(input)).toBe(output);
	});
}
