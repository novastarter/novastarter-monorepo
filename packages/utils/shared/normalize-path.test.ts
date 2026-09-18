import { describe, expect, it } from 'vitest';
import { normalizePath } from './normalize-path.js';

describe('normalizePath', () => {
	describe('basic path normalization', () => {
		it('returns "/" for single backslash', () => {
			expect(normalizePath('\\')).toBe('/');
		});

		it('returns "/" for single forward slash', () => {
			expect(normalizePath('/')).toBe('/');
		});

		it('returns empty string for empty input', () => {
			expect(normalizePath('')).toBe('');
		});

		it('returns single character as-is', () => {
			expect(normalizePath('a')).toBe('a');
		});
	});

	describe('backslash to forward slash conversion', () => {
		it('converts backslashes to forward slashes', () => {
			expect(normalizePath('a\\b\\c')).toBe('a/b/c');
		});

		it('handles mixed slashes', () => {
			expect(normalizePath('a/b\\c/d')).toBe('a/b/c/d');
		});

		it('handles Windows-style paths', () => {
			// 1. The drive letter and colon are ordinary characters to the function; only separators change
			expect(normalizePath('C:\\Users\\name\\file.txt')).toBe('C:/Users/name/file.txt');
		});
	});

	describe('consecutive slash handling', () => {
		it('collapses multiple forward slashes', () => {
			expect(normalizePath('a//b///c')).toBe('a/b/c');
		});

		it('collapses multiple backslashes', () => {
			expect(normalizePath('a\\\\b\\\\\\c')).toBe('a/b/c');
		});

		it('collapses mixed consecutive slashes', () => {
			expect(normalizePath('a/\\b\\/c')).toBe('a/b/c');
		});
	});

	describe('trailing slash handling', () => {
		it('removes trailing forward slash', () => {
			expect(normalizePath('a/b/c/')).toBe('a/b/c');
		});

		it('removes trailing backslash', () => {
			expect(normalizePath('a\\b\\c\\')).toBe('a/b/c');
		});

		it('removes multiple trailing slashes', () => {
			expect(normalizePath('a/b/c///')).toBe('a/b/c');
		});
	});

	describe('UNC path handling', () => {
		it('handles UNC paths with ?', () => {
			// 1. The `\\?\` prefix must survive as `//?/`; collapsing it would turn the path into a relative one
			expect(normalizePath('\\\\?\\C:\\path')).toBe('//?/C:/path');
		});

		it('handles UNC paths with .', () => {
			// 1. Same for the device namespace prefix `\\.\`
			expect(normalizePath('\\\\.\\device\\path')).toBe('//./device/path');
		});
	});

	describe('removeLeading option', () => {
		it('removes leading slash when removeLeading is true', () => {
			expect(normalizePath('/a/b/c', { removeLeading: true })).toBe('a/b/c');
		});

		it('keeps leading slash when removeLeading is false', () => {
			expect(normalizePath('/a/b/c', { removeLeading: false })).toBe('/a/b/c');
		});

		it('keeps leading slash by default', () => {
			expect(normalizePath('/a/b/c')).toBe('/a/b/c');
		});

		it('handles path without leading slash with removeLeading true', () => {
			// 1. The option must be a no-op on a relative path rather than eat its first character
			expect(normalizePath('a/b/c', { removeLeading: true })).toBe('a/b/c');
		});
	});

	describe('edge cases', () => {
		it('handles path with only slashes', () => {
			// 1. A run of separators splits into two empty segments; the trailing one is dropped and the remaining
			//    empty segment joins to an empty string
			expect(normalizePath('///')).toBe('');
		});

		it('handles path starting with multiple slashes', () => {
			expect(normalizePath('///a/b')).toBe('/a/b');
		});

		it('handles relative paths', () => {
			// 1. `.` and `..` are not resolved; the function only rewrites separators
			expect(normalizePath('./a/b')).toBe('./a/b');
		});

		it('handles parent directory references', () => {
			expect(normalizePath('../a/b')).toBe('../a/b');
		});

		it('handles paths with dots', () => {
			expect(normalizePath('a.txt')).toBe('a.txt');
			expect(normalizePath('path/to/file.txt')).toBe('path/to/file.txt');
		});

		it('handles paths with spaces', () => {
			expect(normalizePath('path/to/my file.txt')).toBe('path/to/my file.txt');
		});
	});
});
